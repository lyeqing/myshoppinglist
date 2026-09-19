import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { Job, Session } from "../src/lib/api-types";

let server: Server;
let sessions: Map<string, Session>;
let jobs: Map<number, Job>;
let counts: Map<number, number>;
let expire = false;
let offline = false;
let frozen = false;
let failNextSubmit = false;
let calls = 0;
let receivedCookie = "";
const sessionExpiry = () => new Date(Date.now() + 3 * 3600000).toISOString();
const product = { id: 1, name: "Coca-Cola Classic Cans", brand: "Coca-Cola", variant: "Classic", packQuantity: 10, packSize: 375, packUnit: "mL", imageUrl: null };
function completed(job: Job): Job { return { ...job, product, status: "Partial", progressStage: "Completed", shoppingListProductId: job.jobId, completedDate: new Date().toISOString(), retailers: [
  { shopId: 1, shopName: "Coles", status: "Exact", matchType: "Exact", matchConfidence: 100, isFromCache: false, checkedDate: job.createdDate, errorCode: null, prices: [{ price: 23, normalPrice: null, unitPrice: null, currency: "AUD", shopLocationId: null, priceScope: "Unknown", sourceType: "StructuredData", sourceUrl: "https://www.coles.com.au/product/test", checkedDate: job.createdDate, inStock: true, specialType: null, specialDescription: null, specialStartDate: null, specialEndDate: null }] },
  { shopId: 2, shopName: "Woolworths", status: "NotSupported", matchType: null, matchConfidence: null, isFromCache: false, checkedDate: null, errorCode: "comparison_not_implemented", prices: [] }
] }; }
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    calls++;
    response.setHeader("Content-Type", "application/json");
    const send = (status: number, value?: unknown) => { response.statusCode = status; response.end(value === undefined ? undefined : JSON.stringify(value)); };
    const path = new URL(request.url!, "http://127.0.0.1:5499");
    if (offline) { send(503, { title: "Private upstream failure details" }); return; }
    if (request.method === "POST" && (request.headers.origin !== "http://127.0.0.1:5499" || request.headers["x-myshoppinglist-request"] !== "1")) { send(403); return; }
    receivedCookie = request.headers.cookie ?? "";
    const raw = /myshoppinglist_session=([a-f0-9]+)/.exec(receivedCookie)?.[1];
    const current = raw && !expire ? sessions.get(raw) : undefined;
    if (path.pathname === "/api/auth/trial") {
      if (current) { send(200, current); return; }
      const token = randomBytes(32).toString("hex"); const id = sessions.size + 1;
      const session: Session = { account: { id, displayName: "Trial shopper", isTrial: true, expiresDate: sessionExpiry() }, shoppingListId: id, sessionExpiresDate: sessionExpiry() };
      sessions.set(token, session); expire = false;
      response.setHeader("Set-Cookie", `myshoppinglist_session=${token}; Path=/; HttpOnly; SameSite=Lax`); send(201, session); return;
    }
    if (!current) { send(401, { title: "A valid session is required." }); return; }
    if (path.pathname === "/api/auth/me") { send(200, current); return; }
    if (path.pathname === "/api/auth/logout") { sessions.delete(raw!); response.setHeader("Set-Cookie", "myshoppinglist_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"); send(204); return; }
    if (path.pathname.endsWith("/products/url")) {
      if (failNextSubmit) { failNextSubmit = false; response.setHeader("Retry-After", "60"); send(429, { title: "Too many requests" }); return; }
      let body = ""; for await (const chunk of request) body += chunk;
      const value = JSON.parse(body);
      if (!value.url.startsWith("https://www.coles.com.au/product/")) { send(400, { title: "Enter a valid Coles product URL." }); return; }
      const id = jobs.size + 1; const created = new Date().toISOString();
      jobs.set(id, { jobId: id, shoppingListId: current.shoppingListId!, quantity: value.quantity, status: "Queued", progressStage: "Queued", product: null, shoppingListProductId: null, createdDate: created, lastActivityDate: created, completedDate: null, nextAttemptDate: null, errorCode: null, retailers: [] });
      response.setHeader("Location", `/api/product-import-jobs/${id}`);
      send(202, { jobId: id, status: "Queued", quantity: value.quantity, reused: false, statusUrl: `/api/product-import-jobs/${id}` }); return;
    }
    if (path.pathname.endsWith("/imports")) {
      const before = Number(path.searchParams.get("beforeId")) || Infinity;
      const entries = [...jobs.values()].filter(j => j.shoppingListId === current.shoppingListId && j.jobId < before).sort((a, b) => b.jobId - a.jobId);
      const items = entries.slice(0, 20).map(j => ({ jobId: j.jobId, status: j.status, createdDate: j.createdDate }));
      send(200, { items, nextBeforeId: entries.length > 20 ? items.at(-1)!.jobId : null }); return;
    }
    const id = Number(path.pathname.split("/").at(-1)); const job = jobs.get(id);
    if (!job || job.shoppingListId !== current.shoppingListId) { send(404); return; }
    const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
    const next = frozen || count < 2 ? { ...job, status: "Processing" as const, progressStage: "ReadingSourceProduct" } : completed(job);
    jobs.set(id, next); send(200, next);
  });
  await new Promise<void>(resolve => server.listen(5499, "127.0.0.1", resolve));
});
test.beforeEach(() => { sessions = new Map(); jobs = new Map(); counts = new Map(); expire = false; offline = false; frozen = false; failNextSubmit = false; calls = 0; receivedCookie = ""; });
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
async function start(page: Page) {
  await page.goto("/"); await page.getByRole("button", { name: "Start my shopping list" }).click();
  await expect(page.getByText("Your trial is active")).toBeVisible();
}
async function add(page: Page, code = "test") {
  await page.getByLabel("Coles product URL").fill(`https://www.coles.com.au/product/${code}`);
  await page.getByRole("button", { name: "Add product", exact: true }).click();
}

test("start, import, price context, terminal polling stop and refresh recovery", async ({ page }, info) => {
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Your list. A clearer price." })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-welcome.png`, fullPage: true });
  await page.getByRole("button", { name: "Start my shopping list" }).click();
  await expect(page.getByText("Your trial is active")).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain("myshoppinglist_session");
  await add(page);
  await expect(page.getByRole("heading", { name: "Finding your product…" })).toBeVisible();
  await expect(page.getByRole("heading", { name: product.name })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Store not verified")).toBeVisible();
  await expect(page.getByText("Comparison not available yet", { exact: true })).toBeVisible();
  const polled = counts.get(1); await page.waitForTimeout(2300); expect(counts.get(1)).toBe(polled);
  await page.reload(); await expect(page.getByRole("heading", { name: product.name })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-list.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Sign out" }).click(); await expect(page.getByRole("button", { name: "Start my shopping list" })).toBeVisible();
});
test("multiple imports remain usable and all polling stops on expiry", async ({ page }) => {
  frozen = true; await start(page); await add(page, "one"); await add(page, "two");
  await expect(page.getByText("2 loaded imports · 2 in progress")).toBeVisible();
  expire = true; await expect(page.getByText("Your trial has ended. Start a new trial to continue.")).toBeVisible({ timeout: 7000 });
  const count = calls; await page.waitForTimeout(2300); expect(calls).toBe(count);
  await expect(page.getByRole("article")).toHaveCount(0);
});
test("validation, rate limits and paused updates retain useful state", async ({ page }) => {
  frozen = true; await start(page);
  await page.getByLabel("Coles product URL").fill("https://example.com/product");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("valid Coles");
  failNextSubmit = true; await add(page); await expect(page.getByRole("alert")).toContainText("60 seconds");
  await add(page); offline = true;
  await expect(page.getByRole("button", { name: "Retry updates" })).toBeVisible({ timeout: 7000 });
  offline = false; frozen = false; await page.getByRole("button", { name: "Retry updates" }).click();
  await expect(page.getByRole("heading", { name: product.name })).toBeVisible({ timeout: 7000 });
});
test("navigation aborts ongoing polling", async ({ page }) => {
  frozen = true; await start(page); await add(page);
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.goto("about:blank"); const count = calls;
  await page.waitForTimeout(2300); expect(calls).toBe(count);
});
test("gateway rejects unknown routes and cross-origin posts without contacting upstream", async ({ request }) => {
  const before = calls;
  expect((await request.get("/api/admin/secrets")).status()).toBe(404);
  expect((await request.post("/api/auth/trial")).status()).toBe(403);
  expect((await request.post("/api/auth/trial", { headers: { "X-MyShoppingList-Request": "1", Origin: "https://evil.example" } })).status()).toBe(403);
  expect((await request.post("/api/shopping-lists/1/products/url", { headers: { "X-MyShoppingList-Request": "1", "Content-Type": "application/json" }, data: "x".repeat(5000) })).status()).toBe(413);
  expect(calls).toBe(before);
  await request.post("/api/auth/trial", { headers: { "X-MyShoppingList-Request": "1" } });
  await request.get("/api/auth/me", { headers: { Cookie: "handytool_session=secret; tracking=private" } });
  expect(receivedCookie).not.toContain("secret"); expect(receivedCookie).not.toContain("tracking");
});
