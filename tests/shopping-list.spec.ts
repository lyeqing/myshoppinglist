import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { Job, Session, ListItem, ListItemUpdate } from "../src/lib/api-types";
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
let listItems = new Map<number, ListItem>();
let failEdit = false;
let accounts = new Map<string, { password: string; session: Session }>();
let failAuth = false;
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
    if (["POST", "PUT"].includes(request.method!) && (request.headers.origin !== "http://127.0.0.1:5499" || request.headers["x-myshoppinglist-request"] !== "1")) { send(403); return; }
    receivedCookie = request.headers.cookie ?? "";
    const raw = /myshoppinglist_session=([a-f0-9]+)/.exec(receivedCookie)?.[1];
    const current = raw && !expire ? sessions.get(raw) : undefined;
    if (path.pathname === "/api/auth/register" || path.pathname === "/api/auth/login") {
      if (failAuth) { response.setHeader("Retry-After", "60"); send(429); return; }
      let body = ""; for await (const part of request) body += part;
      const value = JSON.parse(body); const email = value.email?.trim().toLowerCase();
      const register = path.pathname.endsWith("register");
      if (register && raw && !current) { send(401); return; }
      if (register && accounts.has(email)) { send(409, { title: "Registration could not be completed with this email." }); return; }
      if (!register && (!accounts.has(email) || accounts.get(email)!.password !== value.password)) { send(401); return; }
      const id = current?.account.id ?? 100 + accounts.size;
      const session: Session = register ? { account: { id, displayName: value.displayName, isTrial: false, expiresDate: null }, shoppingListId: current?.shoppingListId ?? id, sessionExpiresDate: new Date(Date.now()+30*86400000).toISOString() } : { ...accounts.get(email)!.session, sessionExpiresDate: new Date(Date.now()+30*86400000).toISOString() };
      if (register) { accounts.set(email, { password: value.password, session }); for (const [token, old] of sessions) if (old.account.id === id) sessions.delete(token); }
      const token = randomBytes(32).toString("hex"); sessions.set(token, session); expire = false;
      response.setHeader("Set-Cookie", `myshoppinglist_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
      send(register ? 201 : 200, session); return;
    }
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
    const listRoute = /^\/api\/shopping-lists\/(\d+)\/items(?:\/(\d+))?$/.exec(path.pathname);
    if (listRoute) {
      if (Number(listRoute[1]) !== current.shoppingListId) { send(404); return; }
      if (request.method === "GET" && !listRoute[2]) {
        const before = Number(path.searchParams.get("beforeId")) || Infinity;
        const all = [...listItems.values()].filter(i => i.shoppingListId === current.shoppingListId && i.id < before
          && (path.searchParams.get("includeHidden") === "true" || !i.isHidden)
          && (path.searchParams.get("includePurchased") !== "false" || !i.isPurchased)).sort((a,b) => b.id-a.id);
        const items = all.slice(0,20); send(200, { items, nextBeforeId: all.length > 20 ? items.at(-1)!.id : null }); return;
      }
      if (request.method === "PUT" && listRoute[2]) {
        if (failEdit) { send(503, { title: "Unavailable" }); return; }
        const item = listItems.get(Number(listRoute[2]));
        if (!item || item.shoppingListId !== current.shoppingListId) { send(404); return; }
        let body = ""; for await (const part of request) body += part;
        const edit = JSON.parse(body) as ListItemUpdate;
        if (edit.expectedUpdatedDate !== item.updatedDate) { send(409, { title: "This item changed. Reload it before saving your edits." }); return; }
        if (!Number.isInteger(edit.quantity) || edit.quantity < 1 || (edit.notes?.length ?? 0) > 4000) { send(400, { title: "Invalid edit" }); return; }
        const saved = { ...item, quantity: edit.quantity, notes: edit.notes, isPurchased: edit.isPurchased, isHidden: edit.isHidden,
          purchasedDate: edit.isPurchased ? item.purchasedDate ?? new Date().toISOString() : null,
          updatedDate: new Date(Math.max(Date.now(), Date.parse(item.updatedDate)+1)).toISOString() };
        listItems.set(item.id, saved); send(200, saved); return;
      }
      send(404); return;
    }
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
    if (next.product) {
      let item = [...listItems.values()].find(i => i.product.id === next.product!.id && i.shoppingListId === next.shoppingListId);
      if (!item) { item = { id: listItems.size+1, shoppingListId: next.shoppingListId, product: next.product, quantity: next.quantity,
        notes: null, isPurchased: false, isHidden: false, purchasedDate: null, preferredShopId: null, addedDate: next.createdDate, updatedDate: next.createdDate }; listItems.set(item.id,item); }
      next.shoppingListProductId = item.id;
    }
    jobs.set(id, next); send(200, next);
  });
  await new Promise<void>(resolve => server.listen(5499, "127.0.0.1", resolve));
});
test.beforeEach(() => { accounts = new Map(); failAuth = false; sessions = new Map(); jobs = new Map(); sources = new Map(); counts = new Map(); expire = false; offline = false; frozen = false; failNextSubmit = false; calls = 0; receivedCookie = ""; comparison = null; listItems = new Map(); failEdit = false; });
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
async function start(page: Page) {
  await page.goto("/"); await page.getByRole("button", { name: "Start my shopping list" }).click();
  await expect(page.getByText("Your trial is active")).toBeVisible();
}
const accountPassword = "A long unique passphrase 123";
async function fillAccount(page: Page, register = true) {
  if (register) await page.getByLabel("Display name").fill("Test shopper");
  await page.getByLabel("Email", { exact: true }).fill("shopper@example.test");
  await page.getByLabel("Password", { exact: true }).fill(accountPassword);
}

test("account registration, login failures, rate limits and refresh recovery", async ({ page }, info) => {
  await page.goto("/"); await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await fillAccount(page);
  await page.screenshot({ path: `test-results/${info.project.name}-registration.png`, fullPage: true });
  failAuth = true; await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "60 seconds" })).toBeVisible();
  failAuth = false; await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Signed in as Test shopper")).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain("myshoppinglist_session");
  await page.reload(); await expect(page.getByText("Signed in as Test shopper")).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await fillAccount(page, false);
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Sign in to my account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The email or password is incorrect." })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(accountPassword);
  await page.getByRole("button", { name: "Sign in to my account" }).click();
  await expect(page.getByText("Signed in as Test shopper")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("account trial conversion preserves saved edits and unsaved drafts", async ({ page }, info) => {
  await start(page); await add(page);
  await expect(page.getByLabel("Notes", { exact: true })).toBeVisible();
  await page.getByLabel("Notes", { exact: true }).fill("Saved note");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => [...listItems.values()][0]?.notes).toBe("Saved note");
  await page.getByLabel("Notes", { exact: true }).fill("Unsaved draft");
  const old = [...sessions.values()][0];
  await page.getByRole("button", { name: "Keep my list", exact: true }).click(); await fillAccount(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Signed in as Test shopper")).toBeVisible();
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Unsaved draft");
  expect(accounts.get("shopper@example.test")!.session.shoppingListId).toBe(old.shoppingListId);
  await page.screenshot({ path: `test-results/${info.project.name}-registered-list.png`, fullPage: true });
  await page.reload(); await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Saved note");
});

test("account login replaces trial view without merging trial items", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Create an account", exact: true }).click(); await fillAccount(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page.getByText("Signed in as Test shopper")).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await start(page); await add(page); await expect(page.getByLabel("Notes", { exact: true })).toBeVisible();
  const trialItem = [...listItems.values()][0];
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/This trial list will not be merged/)).toBeVisible();
  await fillAccount(page, false); await page.getByRole("button", { name: "Sign in to my account" }).click();
  await expect(page.getByText("Signed in as Test shopper")).toBeVisible();
  await expect(page.getByLabel("Notes", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(listItems.get(trialItem.id)!.shoppingListId).toBe(trialItem.shoppingListId);
});

test("account expired trial requires explicit reset before fresh registration", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Keep my list", exact: true }).click(); await fillAccount(page);
  expire = true;
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Clear expired session for a new account" })).toBeVisible();
  expect(accounts.size).toBe(0);
  await page.getByRole("button", { name: "Clear expired session for a new account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "empty list" })).toBeVisible();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Signed in as Test shopper")).toBeVisible();
  expect(accounts.size).toBe(1);
});

test("account session survives timer maximum and expires at its actual deadline", async ({ page }) => {
  await page.clock.install();
  await page.goto("/"); await page.getByRole("button", { name: "Create an account", exact: true }).click(); await fillAccount(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page.getByText("Signed in as Test shopper")).toBeVisible();
  await page.clock.fastForward(2147483647);
  await expect(page.getByText("Signed in as Test shopper")).toBeVisible();
  await page.clock.fastForward(7*86400000);
  await expect(page.getByText("Your session has ended. Sign in again or start a new trial.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
});

test("account gateway enforces JSON, sizes, methods and safe expired reset", async ({ page }) => {
  await start(page);
  const results = await page.evaluate(async () => {
    const send = async (path: string, method: string, body?: string, headers: Record<string,string> = {}) => (await fetch('/api/auth/'+path, { method, body, headers })).status;
    const headers = { "Content-Type": "application/json", "X-MyShoppingList-Request": "1" };
    return [await send('register','POST','{}'), await send('login','PUT','{}',headers),
      await send('register','POST','{}', { 'X-MyShoppingList-Request': '1' }), await send('register','POST','{',headers),
      await send('login','POST',JSON.stringify({password:'a'.repeat(17000)}),headers),
      await send('reset-expired','POST',undefined,headers), await send('reset-expired','GET')];
  });
  expect(results).toEqual([403,404,415,400,413,409,404]);
  await page.reload(); await expect(page.getByText("Your trial is active")).toBeVisible();
});
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

test("list edits survive refresh, repeated imports and hide/restore controls", async ({ page }, info) => {
  await start(page); await add(page);
  const list = page.getByRole("region", { name: "Editable shopping list" });
  const editor = list.getByRole("group", { name: `Edit ${product.name}` });
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.getByLabel("Item quantity").fill("4");
  await editor.getByLabel("Notes", { exact: true }).fill("Two for the pantry");
  await editor.getByLabel("Purchased", { exact: true }).check();
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByText("Changes saved.")).toBeVisible();
  expect(listItems.get(1)!.purchasedDate).not.toBeNull();
  await page.reload();
  await expect(editor.getByLabel("Item quantity")).toHaveValue("4");
  await expect(editor.getByLabel("Notes", { exact: true })).toHaveValue("Two for the pantry");
  await list.getByLabel("Show purchased", { exact: true }).uncheck();
  await expect(editor).toBeHidden();
  await list.getByLabel("Show purchased", { exact: true }).check();
  await editor.getByLabel("Purchased", { exact: true }).uncheck();
  await editor.getByLabel("Hidden", { exact: true }).check();
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor).toBeHidden();
  await list.getByLabel("Show hidden", { exact: true }).check();
  await expect(editor).toBeVisible();
  expect(listItems.get(1)!.purchasedDate).toBeNull();
  await editor.getByLabel("Hidden", { exact: true }).uncheck();
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByText("Changes saved.")).toBeVisible();
  await add(page, "same-product");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: product.name })).toHaveCount(2);
  await expect(list.getByRole("group", { name: /^Edit / })).toHaveCount(1);
  await expect(editor.getByLabel("Item quantity")).toHaveValue("4");
  await page.screenshot({ path: `test-results/${info.project.name}-editing.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("failed saves and conflicts preserve drafts until explicit reload", async ({ page }) => {
  await start(page); await add(page);
  const editor = page.getByRole("group", { name: `Edit ${product.name}` });
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.getByLabel("Notes", { exact: true }).fill("Unsaved draft");
  failEdit = true;
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(editor.getByLabel("Notes", { exact: true })).toHaveValue("Unsaved draft");
  failEdit = false;
  const original = listItems.get(1)!;
  listItems.set(1, { ...original, notes: "Changed elsewhere", updatedDate: new Date(Date.parse(original.updatedDate)+1).toISOString() });
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("This item changed");
  await expect(editor.getByLabel("Notes", { exact: true })).toHaveValue("Unsaved draft");
  await expect(editor.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Load latest saved version" }).click();
  await expect(editor.getByLabel("Notes", { exact: true })).toHaveValue("Changed elsewhere");
  await editor.getByLabel("Notes", { exact: true }).fill("");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByText("Changes saved.")).toBeVisible();
  expect(listItems.get(1)!.notes).toBeNull();
});

test("list pagination and refresh preserve drafts; expiry clears editors", async ({ page }) => {
  await start(page); await add(page);
  const editor = page.getByRole("group", { name: `Edit ${product.name}`, exact: true });
  await expect(editor).toBeVisible({ timeout: 10000 });
  const original = listItems.get(1)!;
  for (let id=2; id<=22; id++) listItems.set(id, { ...original, id, product: { ...product, id, name: `Extra product ${id}` } });
  await page.reload();
  const list = page.getByRole("region", { name: "Editable shopping list" });
  await expect(list.getByRole("group", { name: /^Edit / })).toHaveCount(20);
  await list.getByRole("button", { name: "Load more items" }).click();
  await expect(list.getByRole("group", { name: /^Edit / })).toHaveCount(22);
  await editor.getByLabel("Notes", { exact: true }).fill("Keep my draft");
  await list.getByRole("button", { name: "Refresh items" }).click();
  await expect(list.getByText("Loading list items…")).toHaveCount(0);
  await expect(editor.getByLabel("Notes", { exact: true })).toHaveValue("Keep my draft");
  await list.getByLabel("Show purchased", { exact: true }).uncheck();
  await expect(editor.getByLabel("Notes", { exact: true })).toHaveValue("Keep my draft");
  expire = true;
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Your trial has ended. Start a new trial to continue.")).toBeVisible();
  await expect(list).toHaveCount(0);
});

test("editing gateway allows full-length notes and rejects unsafe routes and filters", async ({ page, request }) => {
  await start(page); await add(page);
  const editor = page.getByRole("group", { name: `Edit ${product.name}` });
  await expect(editor).toBeVisible({ timeout: 10000 });
  const notes = "購".repeat(4000);
  await editor.getByLabel("Notes", { exact: true }).fill(notes);
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByText("Changes saved.")).toBeVisible();
  expect(listItems.get(1)!.notes).toBe(notes);
  const before = calls;
  expect((await request.put("/api/shopping-lists/1/items/1", { data: {} })).status()).toBe(403);
  const headers = { "X-MyShoppingList-Request": "1", "Content-Type": "application/json" };
  expect((await request.put("/api/auth/trial", { headers, data: {} })).status()).toBe(404);
  expect((await request.post("/api/shopping-lists/1/items/1", { headers, data: {} })).status()).toBe(404);
  expect((await request.put("/api/shopping-lists/1/items/1", { headers: { ...headers, Origin: "https://evil.example" }, data: {} })).status()).toBe(403);
  expect((await request.put("/api/shopping-lists/1/items/1", { headers, data: "a".repeat(32769) })).status()).toBe(413);
  expect((await request.get("/api/shopping-lists/1/items?includeHidden=invalid")).status()).toBe(400);
  expect((await request.get("/api/shopping-lists/1/items?includePurchased=true&includePurchased=false")).status()).toBe(400);
  expect(calls).toBe(before);
});

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
