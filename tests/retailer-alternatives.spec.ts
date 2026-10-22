import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { BrandAlternative, ListItem, ShoppingListSubstitutionChoice } from "../src/lib/api-types";
const timestamp = new Date().toISOString();
const original: ListItem = {
  id: 1, shoppingListId: 1,
  product: { id: 1, name: "Bakers Life Light Rye Bread 680g", brand: "Bakers Life", variant: null, packQuantity: 1, packSize: 680, packUnit: "g", imageUrl: null },
  quantity: 2, notes: "Keep my usual bread", isPurchased: false, purchasedDate: null, isHidden: false, preferredShopId: null, addedDate: timestamp, updatedDate: timestamp,
};
const alternative = (shop: number): BrandAlternative => ({
  relationship: "SuggestedDifferentBrand", label: "Suggested alternative — check suitability",
  product: { ...original.product, id: shop + 1, name: `Other${shop} Light Rye Bread 800g`, brand: `Other${shop}`, packSize: 800 },
  totalQuantity: 800, unit: "g", quantityRatio: 800 / 680,
  offer: { shopId: shop, shopName: shop === 1 ? "Coles" : "Woolworths", price: shop === 1 ? 3 : 4, unitPrice: (shop === 1 ? 3 : 4) / 8, status: "Fresh", checkedDate: timestamp, productUrl: shop === 1 ? "https://www.coles.com.au/product/bread-1234567" : "https://www.woolworths.com.au/shop/productdetails/1234567" },
  original: { shopId: 3, shopName: "ALDI", price: 2.5, unitPrice: 2.5 / 6.8, status: "Fresh", checkedDate: timestamp, productUrl: "https://www.aldi.com.au/product/bread-400367", observation: { sourceType: "BrowserExtension", priceScope: "Unknown", sourceUrl: null } },
  unitPriceDifferencePercent: null, packagePriceDifference: null,
});
async function setup(page: Page) {
  let item = structuredClone(original);
  let choices: ShoppingListSubstitutionChoice[] = [];
  let error = 0;
  let version = Date.now();
  let stale = false;
  let deal = false;
  let account = 1;
  let calls = 0;
  let delay = false;
  let release: (() => void) | undefined;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const send = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path.endsWith("/auth/me")) return send({ account: { id: account, displayName: "Alex", isTrial: false, isPaid: false }, shoppingListId: 1 });
    if (/substitutions\/[12]$/.test(path)) {
      calls++;
      const data = route.request().postDataJSON();
      expect(data.expectedAccountId).toBe(1);
      if (delay) await new Promise<void>(resolve => { release = resolve; });
      if (account !== 1) return send({ title: "Your account changed. Reload your list." }, 409);
      if (error) return send({ title: "This item changed. Reload before choosing an alternative." }, error);
      expect(data.expectedUpdatedDate).toBe(item.updatedDate);
      const shop = Number(path.split("/").at(-1)); const a = alternative(shop);
      choices = choices.filter(c => c.shopId !== shop);
      if (data.alternativeProductId !== null) choices.push({ shopId: shop, shopName: a.offer.shopName, product: a.product, quantity: data.quantity, status: "Fresh", updatedDate: new Date(++version).toISOString(), offer: a.offer, multibuy: deal && shop === 1 ? { quantity: 2, total: 5, unitPrice: 2.5, savings: 1 } : null });
      item = { ...item, updatedDate: new Date(++version).toISOString() };
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/shopping-preferences")) return send({ accountId: account, compareOnlyPreferredShops: true, includeDifferentBrands: true, includeDifferentPackSizes: false, shops: [{ shopId: 1, isEnabled: true }, { shopId: 2, isEnabled: true }], availableShops: [], updatedDate: timestamp });
    if (path.endsWith("/manage")) return send({ isPaid: false, limit: 2, lists: [{ id: 1, name: "Weekly", createdDate: timestamp, updatedDate: timestamp }] });
    if (path.endsWith("/imports")) return send({ items: [], nextBeforeId: null });
    if (/discovery$/.test(path)) return send({ accountId: account, listId: 1, itemId: path.includes("/items/") ? 1 : null, enabled: false, canStart: false, reason: null, jobs: [], queued: 0, alreadyRunning: 0, recent: 0 });
    const saved = choices.map(c => ({ ...c, status: stale ? "Stale price" : c.status }));
    const prices = [1, 2].map(shop => {
      const choice = saved.find(c => c.shopId === shop);
      return { shopId: shop, shopName: alternative(shop).offer.shopName, price: choice?.status === "Fresh" ? alternative(shop).offer.price : null, status: choice ? choice.status : "Match not checked", includedInTotal: !!choice && !stale, checkedDate: timestamp, productUrl: alternative(shop).offer.productUrl, specialDescription: null, substitution: choice ?? null, multibuy: choice?.multibuy, quantityPrice: choice && deal && shop === 1 ? { quantity: choice.quantity, total: Math.floor(choice.quantity / 2) * 5 + choice.quantity % 2 * 3, ordinaryTotal: choice.quantity * 3, savings: Math.floor(choice.quantity / 2), appliedBundles: Math.floor(choice.quantity / 2), remainingQuantity: choice.quantity % 2 } : null };
    });
    const offers = [alternative(1), alternative(2)].map(a => stale ? { ...a, offer: { ...a.offer, status: "Stale price" } } : a);
    const row = { item, prices, brandAlternatives: offers, packAlternatives: [], substitutions: saved };
    const baskets = [1, 2].map(shop => {
      const choice = saved.find(c => c.shopId === shop);
      const priced = choice?.status === "Fresh";
      return { shopId: shop, shopName: alternative(shop).offer.shopName, name: alternative(shop).offer.shopName, subtotal: priced ? (prices.find(p => p.shopId === shop)?.quantityPrice?.total ?? choice.quantity * alternative(shop).offer.price!) : 0, pricedCount: priced ? 1 : 0, needsChoiceCount: !choice && !stale ? 1 : 0, substitutionCount: priced ? 1 : 0, comparableSubtotal: 0, savingsBySplitting: 0, missingItems: priced ? [] : [{ itemId: 1, name: item.product.name, reason: !choice && !stale ? "Alternative available — choose a product" : "Stale price" }] };
    });
    const lowest = baskets.filter(b => b.pricedCount).sort((a, b) => a.subtotal - b.subtotal)[0];
    if (path.endsWith("/plan")) return send({ id: 1, name: "Weekly", items: [row], lowest: { shopId: null, name: "Lowest total across shops", subtotal: lowest?.subtotal ?? 0, pricedCount: lowest ? 1 : 0, missingItems: lowest ? [] : baskets[0].missingItems, needsChoiceCount: lowest ? 0 : 1, substitutionCount: lowest ? 1 : 0 }, retailers: baskets });
    if (path.endsWith("/items")) return send({ items: [item], nextBeforeId: null });
    if (path.endsWith("/in-store")) return send({ id: 1, name: "Weekly", items: [row], retailers: [{ id: 1, name: "Coles" }, { id: 2, name: "Woolworths" }], remainingCount: 1, baskets, splitSubtotal: lowest?.subtotal ?? 0, splitPricedCount: lowest ? 1 : 0, comparableCount: 0, comparableSplitSubtotal: 0 });
    if (path === "/api/shopping-lists") return send([{ id: 1, name: "Weekly", remainingCount: 1, retailers: [{ id: 1, name: "Coles" }, { id: 2, name: "Woolworths" }] }]);
    return route.fulfill({ status: 404 });
  });
  return { deal: () => { deal = true; }, calls: () => calls, choices: () => choices, fail: (value: number) => { error = value; }, stale: () => { stale = true; }, defer: () => { delay = true; }, release: () => release?.(), switchAccount: () => { account = 2; choices = []; } };
}
async function open(page: Page, view: string) {
  await page.goto(view === "planning" ? "/" : "/in-store");
  if (view === "in-store") {
    await page.getByRole("button", { name: /Weekly/ }).click();
    await page.locator("#retailer").selectOption("1");
  }
}
for (const view of ["planning", "in-store"]) {
  test(`${view}: choose Coles bread with package count, reload, keep Woolworths independent, and undo`, async ({ page }, info) => {
    const fixture = await setup(page); await open(page, view);
    const panel = page.getByRole("region", { name: "Alternative brands", exact: true });
    await expect(panel.getByText("ALDI: $2.50 per package", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Subtotal — 1 item needs a choice").first()).toBeVisible();
    const quantity = panel.getByRole("spinbutton", { name: "Packages of Other1 Light Rye Bread 800g at Coles" });
    await quantity.fill("3");
    await panel.getByRole("button", { name: "Use this alternative at Coles", exact: true }).click();
    await expect(panel.getByText("Chosen for Coles: Other1 Light Rye Bread 800g", { exact: true })).toBeVisible();
    expect(fixture.choices()[0].quantity).toBe(3);
    await expect(page.getByText("$9.00", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bakers Life Light Rye Bread 680g", exact: true })).toBeVisible();
    await expect(panel.getByText(/3 packages/).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("chosen-alternative.png"), fullPage: true });
    await page.reload();
    if (view === "in-store") { await page.getByRole("button", { name: /Weekly/ }).click(); await page.locator("#retailer").selectOption("1"); }
    await expect(panel.getByRole("button", { name: "Undo choice for Coles" })).toBeVisible();
    if (view === "in-store") await page.locator("#retailer").selectOption("2");
    await panel.getByRole("button", { name: "Use this alternative at Woolworths" }).click();
    await expect(panel.getByText("Chosen for Woolworths: Other2 Light Rye Bread 800g")).toBeVisible();
    if (view === "in-store") await page.locator("#retailer").selectOption("1");
    await panel.getByRole("button", { name: "Undo choice for Coles" }).click();
    await expect(panel.getByRole("button", { name: "Use this alternative at Coles" })).toBeVisible();
    expect(fixture.choices().map(c => c.shopId)).toEqual([2]);
    expect(fixture.calls()).toBe(3);
  });
  test(`${view}: multibuy uses the chosen alternative package quantity`, async ({ page }) => {
    const fixture = await setup(page); fixture.deal(); await open(page, view);
    const panel = page.getByRole("region", { name: "Alternative brands", exact: true });
    await panel.getByRole("spinbutton", { name: "Packages of Other1 Light Rye Bread 800g at Coles" }).fill("3");
    await panel.getByRole("button", { name: "Use this alternative at Coles", exact: true }).click();
    await expect(page.getByText("$8.00", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Deal applied 1 time/).first()).toBeVisible();
  });
  test(`${view}: conflict offers reload and stale choice stays visible without counting its price`, async ({ page }) => {
    const fixture = await setup(page); await open(page, view);
    const panel = page.getByRole("region", { name: "Alternative brands", exact: true });
    fixture.fail(409);
    await panel.getByRole("button", { name: "Use this alternative at Coles" }).click();
    await expect(panel.getByRole("alert")).toContainText("This item changed");
    fixture.fail(0); await panel.getByRole("button", { name: "Reload choices" }).click();
    await panel.getByRole("button", { name: "Use this alternative at Coles" }).click();
    await expect(panel.getByRole("button", { name: "Undo choice for Coles" })).toBeVisible();
    fixture.stale(); await page.reload();
    if (view === "in-store") { await page.getByRole("button", { name: /Weekly/ }).click(); await page.locator("#retailer").selectOption("1"); }
    await expect(panel.getByText("Stale price — excluded from subtotal", { exact: false })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Update choice for Coles" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Undo choice for Coles" })).toBeEnabled();
    await expect(page.getByText("$0.00", { exact: false }).first()).toBeVisible();
  });
}
test("switching accounts while a choice is pending never applies the old choice to the new account", async ({ page }) => {
  const fixture = await setup(page); await open(page, "planning"); fixture.defer();
  const panel = page.getByRole("region", { name: "Alternative brands", exact: true });
  await panel.getByRole("button", { name: "Use this alternative at Coles" }).click();
  await expect.poll(fixture.calls).toBe(1);
  fixture.switchAccount(); await page.evaluate(() => window.dispatchEvent(new Event("myshoppinglist-session-changed"))); fixture.release();
  await expect(panel.getByText("Chosen for Coles: Other1 Light Rye Bread 800g")).toHaveCount(0);
  expect(fixture.choices()).toEqual([]);
});
let server: Server;
let writes = 0;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    if (req.method === "PUT" && req.url?.endsWith("/substitutions/1")) { writes++; res.statusCode = 204; res.end(); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>(resolve => server.listen(5499, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
test("choice proxy enforces write protection, JSON, methods and response caching", async ({ page }) => {
  writes = 0;
  await page.context().addCookies([{ name: "myshoppinglist_session", value: "a".repeat(64), url: "http://127.0.0.1:3001" }]);
  const path = "/api/shopping-lists/1/items/1/substitutions/1";
  expect((await page.request.put(path, { data: {} })).status()).toBe(403);
  const headers = { "X-MyShoppingList-Request": "1" };
  expect((await page.request.put(path, { headers: { ...headers, "Content-Type": "text/plain" }, data: "{}" })).status()).toBe(415);
  expect((await page.request.put(path, { headers: { ...headers, Origin: "https://evil.example" }, data: {} })).status()).toBe(403);
  expect(writes).toBe(0);
  const response = await page.request.put(path, { headers, data: { expectedAccountId: 1, alternativeProductId: 2, quantity: 3, expectedUpdatedDate: timestamp } });
  expect(response.status()).toBe(204); expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await page.request.post(path, { headers, data: {} })).status()).toBe(404);
  expect(writes).toBe(1);
});
