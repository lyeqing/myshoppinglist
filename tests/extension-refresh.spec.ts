import { chromium, test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

async function fixture(page: Page) {
  const state = { reads: 0, price: 4 };
  const date = new Date().toISOString();
  const item = { id: 5, shoppingListId: 2, product: { id: 3, name: "Refresh coffee 500g", brand: "Acme",
    variant: null, packQuantity: null, packSize: 500, packUnit: "g", imageUrl: null },
    quantity: 7, notes: "Keep my notes", isPurchased: false, purchasedDate: null, isHidden: false,
    preferredShopId: null, addedDate: date, updatedDate: date };
  const list = { id: 2, name: "Weekly", remainingCount: 1, retailers: [{ id: 1, name: "Coles" }],
    createdDate: date, updatedDate: date };
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown) => route.fulfill({ json });
    if (path.endsWith("/auth/me")) return send({ account: { id: 1, displayName: "Alex", isTrial: false, isPaid: false },
      shoppingListId: 2, sessionExpiresDate: new Date(Date.now() + 3600000).toISOString() });
    if (path.endsWith("/manage")) return send({ isPaid: false, limit: 2, lists: [list] });
    if (path === "/api/shopping-lists") return send([list]);
    if (path.endsWith("/imports")) return send({ items: [], nextBeforeId: null });
    const price = { shopId: 1, shopName: "Coles", price: state.price, includedInTotal: true, status: "Fresh",
      productUrl: "https://www.coles.com.au/product/123456", checkedDate: date, specialDescription: null };
    const basket = { shopId: null, name: "Lowest total across shops", subtotal: state.price * 7, pricedCount: 1, missingItems: [] };
    if (path.endsWith("/plan")) {
      state.reads++;
      return send({ id: 2, name: "Weekly", items: [{ item, prices: [price] }], lowest: basket, retailers: [] });
    }
    if (path.endsWith("/in-store")) {
      state.reads++;
      return send({ ...list, items: [{ item, prices: [price] }], baskets: [], splitSubtotal: state.price * 7,
        splitPricedCount: 1, comparableCount: 0, comparableSplitSubtotal: 0 });
    }
    return route.fulfill({ status: 404, json: { title: "Not available in this fixture" } });
  });
  return state;
}

async function extension(page: Page, mode: "success" | "partial" | "wait" | "error") {
  await page.evaluate(mode => {
    const calls: string[] = [];
    Object.assign(window, { refreshCalls: calls });
    window.addEventListener("message", event => {
      const message = event.data;
      if (message?.channel !== "myshoppinglist-price-refresh-request") return;
      calls.push(message.action);
      let data: unknown;
      if (message.action === "hello") data = { available: true, version: 1 };
      if (message.action === "start") data = { runId: message.runId, total: 1, completed: 0,
        updated: 0, failed: 0, message: "", done: false };
      if (message.action === "next") {
        if (mode === "wait") return;
        data = { runId: message.runId, total: 1, completed: 1, updated: mode === "partial" ? 0 : 1,
          failed: mode === "partial" ? 1 : 0, message: mode === "partial" ? "Coffee: Open its page to check retailer verification." : "Coffee updated.", done: true };
      }
      window.postMessage({ channel: "myshoppinglist-price-refresh-response", requestId: message.requestId,
        ok: !(mode === "error" && message.action === "start"), data,
        error: "This extension is not enabled on the server." }, location.origin);
    });
  }, mode);
}

for (const view of ["planning", "in-store"]) {
  test(`${view}: missing extension explains installation and can retry after enabling`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto(view === "planning" ? "/" : "/in-store");
    if (view === "in-store") await page.getByRole("button", { name: /Weekly/ }).click();
    await expect(page.getByRole("article").first()).toBeVisible();
    await page.getByRole("button", { name: "Refresh items", exact: true }).click();
    await expect(page.getByText("Connect your extension to update prices", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Installation instructions" }).click();
    await expect(page.getByText(/no Chrome Web Store listing/)).toBeVisible();
    await expect(page.getByText(/Developer mode/)).toBeVisible();
    await extension(page, "success");
    state.price = 6;
    const reads = state.reads;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByText(/1 price observation updated/)).toBeVisible();
    expect(state.reads).toBeGreaterThan(reads);
    await expect(page.getByText("Connect your extension to update prices", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { refreshCalls: string[] }).refreshCalls))
      .toEqual(["hello", "start", "next"]);
  });
}

test("partial results explain unchanged observations; server refusal is not reported as success", async ({ page }) => {
  await fixture(page); await page.goto("/");
  await extension(page, "partial");
  await page.getByRole("button", { name: "Refresh items", exact: true }).click();
  await expect(page.getByText(/1 could not be updated/)).toBeVisible();
  await expect(page.getByText(/Previous observations were kept/)).toBeVisible();
  await page.reload(); await extension(page, "error");
  await page.getByRole("button", { name: "Refresh items", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This extension is not enabled on the server" })).toBeVisible();
});

test("cancel stops further reads and keeps already saved updates", async ({ page }) => {
  await fixture(page); await page.goto("/"); await extension(page, "wait");
  await page.getByRole("button", { name: "Refresh items", exact: true }).click();
  await expect(page.getByText(/Updating prices: 0 of 1/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel refresh", exact: true }).click();
  await expect(page.getByText(/Refresh cancelled. Updates already saved have been kept/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh items", exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { refreshCalls: string[] }).refreshCalls))
    .toEqual(["hello", "start", "next", "cancel"]);
});

test("unpacked extension connects to the website and reads a retailer in its own temporary tab", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Chrome extensions require a desktop Chromium browser.");
  test.setTimeout(60000);
  const extensionPath = resolve("extensions/shopping-list");
  const context = await chromium.launchPersistentContext("", { channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  try {
    const page = await context.newPage();
    const diagnostics: string[] = [];
    context.on("page", tab => {
      tab.on("domcontentloaded", () => { diagnostics.push(`loaded ${tab.url()}`); });
    });
    const state = await fixture(page);
    const submissions: Record<string, unknown>[] = [];
    const product = "https://www.coles.com.au/product/123456";
    const canonicalProduct = "https://www.coles.com.au/product/refresh-coffee-500g-123456";
    await context.route("http://localhost:5392/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/me")) return route.fulfill({ json: { account: { id: 1 } } });
      if (path.endsWith("/price-refresh/2")) return route.fulfill({ json: [
        { itemId: 5, mappingId: 6, name: "Refresh coffee 500g", url: product }] });
      if (path.endsWith("/price-refresh")) {
        submissions.push(route.request().postDataJSON()); state.price = 6;
        return route.fulfill({ json: { updated: true, message: "Price observation updated." } });
      }
      return route.fulfill({ status: 404 });
    });
    await context.route(product, route => route.abort());
    await context.route(canonicalProduct, route => { diagnostics.push("canonical retailer product requested"); return route.fulfill({ contentType: "text/html", body:
      `<html><head><link rel="canonical" href="${canonicalProduct}"><script type="application/ld+json">${JSON.stringify({
        "@type": "Product", sku: "123456", name: "Refresh coffee 500g", offers: { price: 6, priceCurrency: "AUD", url: canonicalProduct },
      })}</script></head><body><h1>Refresh coffee 500g</h1></body></html>` }); });
    await context.addCookies([{ name: "myshoppinglist_session", value: "a".repeat(64), url: "http://localhost:3001", httpOnly: true, sameSite: "Lax" }]);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    // Playwright can miss the initial request of a tab opened by an extension.
    // Hold that navigation until the test attaches routing to the real tab;
    // extraction, bridge messages, API submission and cleanup remain real.
    await worker.evaluate(`(() => {
      const create = chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.create = async options => {
        const tab = await create({ ...options, url: 'about:blank' });
        await new Promise(resolve => { globalThis.releaseRefreshTab = resolve; });
        return chrome.tabs.get(tab.id);
      };
    })()`);
    await page.goto("http://localhost:3001");
    const opened = context.waitForEvent("page");
    await page.getByRole("button", { name: "Refresh items", exact: true }).click();
    const productTab = await opened;
    // Model the destination of the retailer's canonical redirect. HTTP redirect
    // follow-up requests bypass Playwright routing, so load this fixture directly
    // while keeping the original short URL in the server-provided target.
    await productTab.goto(canonicalProduct);
    await expect(productTab).toHaveURL(canonicalProduct);
    await worker.evaluate("globalThis.releaseRefreshTab()");
    try {
      await expect(page.getByText(/1 price observation updated/)).toBeVisible({ timeout: 30000 });
    } catch (error) {
      const worker = context.serviceWorkers()[0];
      if (worker) diagnostics.push(JSON.stringify(await worker.evaluate("chrome.tabs.query({}).then(tabs => tabs.map(t => ({url:t.url,status:t.status,pendingUrl:t.pendingUrl})))")));
      await testInfo.attach("extension-diagnostics", { body: diagnostics.join("\n"), contentType: "text/plain" });
      throw error;
    }
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ itemId: 5, mappingId: 6, listId: 2 });
    expect(submissions[0]).not.toHaveProperty("quantity");
    expect(submissions[0]).toHaveProperty("evidence");
    expect(context.pages().filter(p => p.url().startsWith("https://www.coles.com.au"))).toHaveLength(0);
  } finally { await context.close(); }
});
