import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { Job, Session } from "../src/lib/api-types";
import { bestKnownPrices, freshness } from "../src/lib/price-comparison";

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
let sources = new Map<number, string>();
let comparison: ((job: Job) => Job) | null = null;
const sessionExpiry = () => new Date(Date.now() + 3 * 3600000).toISOString();
const product = { id: 1, name: "Coca-Cola Classic Cans", brand: "Coca-Cola", variant: "Classic", packQuantity: 10, packSize: 375, packUnit: "mL", imageUrl: null };
function completed(job: Job): Job { const woolworths = sources.get(job.jobId)?.includes("woolworths.com.au"); return { ...job, product, status: "Partial", progressStage: "Completed", shoppingListProductId: job.jobId, completedDate: new Date().toISOString(), retailers: [
  { shopId: woolworths ? 2 : 1, shopName: woolworths ? "Woolworths" : "Coles", status: "Exact", matchType: "Exact", matchConfidence: 100, isFromCache: false, checkedDate: job.createdDate, errorCode: null, prices: [{ price: 23, normalPrice: null, unitPrice: null, currency: "AUD", shopLocationId: null, priceScope: "Unknown", sourceType: "StructuredData", sourceUrl: sources.get(job.jobId) ?? "https://www.coles.com.au/product/test", checkedDate: job.createdDate, inStock: true, specialType: null, specialDescription: null, specialStartDate: null, specialEndDate: null }] },
  { shopId: woolworths ? 1 : 2, shopName: woolworths ? "Coles" : "Woolworths", status: "NotSupported", matchType: null, matchConfidence: null, isFromCache: false, checkedDate: null, errorCode: "comparison_not_implemented", prices: [] }
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
      if (!value.url.startsWith("https://www.coles.com.au/product/") && !value.url.startsWith("https://www.woolworths.com.au/shop/productdetails/")) { send(400, { title: "Enter a valid Coles or Woolworths product URL." }); return; }
      const id = jobs.size + 1; sources.set(id, value.url); const created = new Date().toISOString();
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
    const next = frozen || count < 2 ? { ...job, status: "Processing" as const, progressStage: "ReadingSourceProduct" } : comparison ? comparison(completed(job)) : completed(job);
    jobs.set(id, next); send(200, next);
  });
  await new Promise<void>(resolve => server.listen(5499, "127.0.0.1", resolve));
});
test.beforeEach(() => { sessions = new Map(); jobs = new Map(); sources = new Map(); counts = new Map(); expire = false; offline = false; frozen = false; failNextSubmit = false; calls = 0; receivedCookie = ""; comparison = null; });
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
async function start(page: Page) {
  await page.goto("/"); await page.getByRole("button", { name: "Start my shopping list" }).click();
  await expect(page.getByText("Your trial is active")).toBeVisible();
}
async function add(page: Page, code = "test") {
  await page.getByLabel("Product URL").fill(`https://www.coles.com.au/product/${code}`);
  const submitted = page.waitForResponse(response => response.url().endsWith("/products/url") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await submitted;
  await expect(page.getByRole("button", { name: "Add product", exact: true })).toBeEnabled();
}

test("start, import, price context, terminal polling stop and refresh recovery", async ({ page }, info) => {
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Your list. A clearer price." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start my shopping list" })).toBeVisible();
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
  await page.getByLabel("Product URL").fill("https://example.com/product");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "valid Coles" })).toBeVisible();
  failNextSubmit = true; await add(page); await expect(page.getByRole("alert").filter({ hasText: "60 seconds" })).toBeVisible();
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
test("older saved imports are available through cursor pagination", async ({ page }) => {
  await start(page); await add(page);
  await expect(page.getByRole("article")).toHaveCount(1);
  const original = jobs.get(1)!;
  for (let id = 1; id <= 21; id++) { jobs.set(id, completed({ ...original, jobId: id })); counts.set(id, 10); }
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(20);
  await page.getByRole("button", { name: "Load older imports" }).click();
  await expect(page.getByRole("article")).toHaveCount(21);
  await expect(page.getByRole("button", { name: "Load older imports" })).toHaveCount(0);
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


test("Woolworths URL imports and retains its own source after refresh", async ({ page }) => {
  await start(page);
  const url = "https://www.woolworths.com.au/shop/productdetails/32731/coca-cola-classic-soft-drink-bottle";
  await page.getByLabel("Product URL").fill(url);
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await expect(page.getByRole("heading", { name: product.name })).toBeVisible({ timeout: 10000 });
  expect(sources.get(1)).toBe(url);
  const article = page.getByRole("article");
  await expect(article.getByText("Woolworths", { exact: true })).toBeVisible();
  await expect(article.locator(`a[href="${url}"]`)).toBeVisible();
  await page.reload();
  await expect(article.locator(`a[href="${url}"]`)).toBeVisible();
});

function comparable(job: Job): Job {
  const source = job.retailers[0];
  const price = { ...source.prices[0], priceScope: "National" };
  return { ...job, retailers: [
    { ...source, prices: [price] },
    { ...source, shopId: 2, shopName: "Woolworths", isFromCache: true,
      prices: [{ ...price, price: 19, sourceUrl: "https://www.woolworths.com.au/shop/productdetails/test" }] }
  ] };
}

test("verified comparison highlights the best price and retains cache context", async ({ page }, info) => {
  comparison = comparable;
  await start(page); await add(page);
  await expect(page.getByText("Best known price · national", { exact: true })).toBeVisible();
  await expect(page.getByText("at Woolworths", { exact: true })).toBeVisible();
  await expect(page.getByText(/Saved observation/)).toBeVisible();
  await expect(page.getByText("Fresh", { exact: true })).toHaveCount(2);
  await expect(page.getByText(/among 2 retailers/)).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-comparison.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByText("at Woolworths", { exact: true })).toBeVisible();
});

test("unknown stores, uncertain matches and failures do not receive recommendations", async ({ page }) => {
  comparison = job => {
    const result = comparable(job);
    return { ...result, retailers: [
      { ...result.retailers[0], prices: result.retailers[0].prices.map(p => ({ ...p, priceScope: "Unknown" })) },
      { ...result.retailers[1], status: "Likely", matchType: "Likely", prices: [] },
      { ...result.retailers[1], shopId: 3, shopName: "ALDI", status: "Unavailable", prices: [], errorCode: "access_restricted" }
    ] };
  };
  await start(page); await add(page);
  await expect(page.getByText("Store not verified", { exact: true })).toBeVisible();
  await expect(page.getByText(/Identity needs confirmation/)).toBeVisible();
  await expect(page.getByText(/We couldn’t check a current price/)).toBeVisible();
  await expect(page.getByText(/^Best known price ·/)).toHaveCount(0);
});

test("stale prices and expired promotions remain visible with warnings", async ({ page }) => {
  comparison = job => {
    const result = comparable(job);
    result.retailers[0].prices[0].checkedDate = new Date(Date.now() - 25 * 3600000).toISOString();
    result.retailers[1].prices[0].specialEndDate = new Date(Date.now() - 1000).toISOString();
    return result;
  };
  await start(page); await add(page);
  await expect(page.getByText("Price may be stale", { exact: true })).toBeVisible();
  await expect(page.getByText("Promotion ended · price needs checking", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Best known price ·/)).toHaveCount(0);
  await expect(page.getByText("AUD 19.00", { exact: true })).toBeVisible();
});

test("freshness updates after polling stops without another network request", async ({ page }) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  comparison = job => {
    const result = comparable(job);
    for (const retailer of result.retailers) retailer.prices[0].checkedDate = new Date(now - 6 * 3600000 + 30000).toISOString();
    return result;
  };
  await start(page); await add(page);
  await expect(page.getByText("Best known price · national", { exact: true })).toBeVisible();
  const polled = counts.get(1);
  await page.clock.fastForward(61000);
  await expect(page.getByText("Refresh recommended", { exact: true })).toHaveCount(2);
  await expect(page.getByText(/^Best known price ·/)).toHaveCount(0);
  expect(counts.get(1)).toBe(polled);
});

test("comparison rules preserve freshness boundaries, ties and separate price coverage", () => {
  const now = Date.parse("2026-09-20T00:00:00Z");
  const checked = (hours: number) => new Date(now - hours * 3600000).toISOString();
  expect(freshness(checked(6), now)).toBe("Fresh");
  expect(freshness(new Date(now - 6 * 3600000 - 1).toISOString(), now)).toBe("Refresh recommended");
  expect(freshness(checked(24), now)).toBe("Refresh recommended");
  expect(freshness(checked(25), now)).toBe("Price may be stale");
  expect(freshness("invalid", now)).toBe("Check time unverified");
  expect(freshness(checked(-1), now)).toBe("Check time unverified");
  const base = completed({ jobId: 1, createdDate: checked(1) } as Job);
  const retailers = comparable(base).retailers;
  retailers[0].prices[0].price = 19;
  expect(bestKnownPrices(retailers, now)[0].shopNames).toEqual(["Coles", "Woolworths"]);
  const original = structuredClone(retailers[1]);
  const changes = [
    { priceScope: "Unknown" }, { priceScope: "Online" }, { priceScope: "StoreSpecific", shopLocationId: 1 },
    { currency: "USD" }, { inStock: false }, { checkedDate: checked(7) }, { price: -1 },
    { specialEndDate: checked(1) }, { specialStartDate: checked(-1) }, { specialEndDate: "invalid" },
    { specialDescription: "Members only" }, { checkedDate: "invalid" }, { checkedDate: checked(-1) }
  ];
  for (const change of changes) {
    retailers[1] = { ...original, prices: [{ ...original.prices[0], ...change }] };
    expect(bestKnownPrices(retailers, now), JSON.stringify(change)).toEqual([]);
  }
  for (const status of ["Likely", "Possible", "Unavailable", "Pending", "CheckFailed"] as const) {
    retailers[1] = { ...original, status };
    expect(bestKnownPrices(retailers, now)).toEqual([]);
  }
  retailers[1] = { ...original, shopId: retailers[0].shopId };
  expect(bestKnownPrices(retailers, now)).toEqual([]);
  retailers[1] = original;
  for (const retailer of retailers) retailer.prices.push({ ...retailer.prices[0], priceScope: "Online", price: 17 });
  expect(bestKnownPrices(retailers, now).map(group => group.scope)).toEqual(["National", "Online"]);
});
