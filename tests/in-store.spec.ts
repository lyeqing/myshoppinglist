import { test, expect } from "@playwright/test";
import { createInStoreStore, itemGroup } from "../src/stores/in-store-store";
import type { InStoreDetail, InStoreItem } from "../src/lib/api-types";

const shops = [{ id: 1, name: "Coles" }, { id: 2, name: "Woolworths" }];
const session = { account: { id: 1, displayName: "Alex Smith", isTrial: false, expiresDate: null }, shoppingListId: 1, sessionExpiresDate: "2099-01-01T00:00:00Z" };
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ json: session }));
});
function row(id: number, name: string, coles: number | null, woolworths: number | null): InStoreItem {
  return { item: { id, shoppingListId: 1, product: { id, name, brand: "Brand", variant: null, packQuantity: 1, packSize: 500, packUnit: "g", imageUrl: null },
    quantity: 2, notes: null, isPurchased: false, isHidden: false, purchasedDate: null, preferredShopId: null, addedDate: "2026-09-27T01:00:00Z", updatedDate: "2026-09-27T01:00:00Z" },
    prices: shops.map((s, i) => ({ shopId: s.id, shopName: s.name, price: i ? woolworths : coles, status: (i ? woolworths : coles) === null ? "Stale price" : "Fresh", checkedDate: "2026-09-27T01:00:00Z" })) };
}
test("groups all four retailer cases and unknown prices", () => {
  expect([row(1, "A", 2, 3), row(2, "B", 2, null), row(3, "C", 2, 2), row(4, "D", 3, 2), row(5, "E", null, null)].map(r => itemGroup(r, 1))).toEqual([0, 1, 2, 3, 4]);
  expect(itemGroup(row(6, "F", null, 2), 1)).toBe(4);
  expect(createInStoreStore().getState().showPurchased).toBe(false);
});

test("shop selection, basket coverage, purchase and undo work without reloading", async ({ page }) => {
  const items = [row(4, "Other cheaper", 5, 3), row(3, "Equal product", 4, 4), row(2, "Coles only", 2, null), row(1, "Best at Coles", 2, 3)];
  let fail = false;
  await page.route("**/api/shopping-lists**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "PUT") {
      const item = items.find(r => r.item.id === Number(path.split("/").at(-1)))!.item;
      const body = route.request().postDataJSON();
      expect(body.expectedUpdatedDate).toBe(item.updatedDate);
      item.isPurchased = body.isPurchased;
      await route.fulfill({ json: item }); return;
    }
    if (fail) { await route.fulfill({ status: 503, json: { title: "Offline" } }); return; }
    const remaining = items.filter(r => !r.item.isPurchased).length;
    if (path.endsWith("in-store")) {
      const detail: InStoreDetail = { id: 1, name: "Weekly shop", retailers: shops, items, remainingCount: remaining,
        baskets: shops.map(s => ({ shopId: s.id, shopName: s.name, subtotal: 20, pricedCount: s.id === 1 ? remaining : remaining - 1, comparableSubtotal: 16, savingsBySplitting: 2 })),
        splitSubtotal: 18, splitPricedCount: remaining, comparableCount: 3, comparableSplitSubtotal: 14 };
      await route.fulfill({ json: detail });
    } else await route.fulfill({ json: [{ id: 1, name: "Weekly shop", remainingCount: remaining, retailers: shops }] });
  });
  await page.goto("/in-store");
  await page.getByLabel("Where are you shopping?").selectOption("1");
  await page.getByRole("button", { name: /Weekly shop/ }).click();
  await expect(page.locator("article h4")).toHaveText(["Best at Coles", "Coles only", "Equal product", "Other cheaper"]);
  await expect(page.getByText("Subtotal · 3 of 4 items priced")).toBeVisible();
  await expect(page.getByText("Incomplete basket — 3 of 4 items priced")).toBeVisible();
  await expect(page.getByText("Only Woolworths", { exact: true }).locator("..")).toHaveClass(/bg-red-50/);
  await page.getByRole("checkbox", { name: "Purchased Best at Coles" }).click();
  await expect(page.locator("article h4")).toHaveCount(3);
  await page.getByRole("button", { name: "Show purchased" }).click();
  await expect(page.getByRole("checkbox", { name: "Purchased Best at Coles" })).toBeChecked();
  await page.getByRole("checkbox", { name: "Purchased Best at Coles" }).click();
  await expect(page.getByText("4 items remaining")).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "Refresh prices" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("unauthenticated visitors are offered sign in", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ status: 401, json: {} }));
  await page.route("**/api/shopping-lists", route => route.fulfill({ status: 401, json: {} }));
  await page.goto("/in-store");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("in-store sign in shows identity and sign out clears private lists", async ({ page }) => {
  let authenticated = false;
  await page.route("**/api/auth/*", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("login")) authenticated = true;
    if (path.endsWith("logout")) { authenticated = false; await route.fulfill({ status: 204 }); return; }
    await route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? session : {} });
  });
  await page.route("**/api/shopping-lists", route => route.fulfill({ json: [{ id: 1, name: "Private list", remainingCount: 1, retailers: shops }] }));
  await page.goto("/in-store");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("alex@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Password1!");
  await page.getByRole("button", { name: "Sign in to my account" }).click();
  await expect(page.getByRole("group", { name: "Signed in as Alex Smith" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Private list/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "My lists" })).toHaveAttribute("href", "/");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: /Private list/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Signed in as Alex Smith" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("selected retailer leads pricing and missing products are distinct from missing prices", async ({ page }) => {
  const missing = row(2, "Missing product", 2, null);
  missing.prices = missing.prices.filter(p => p.shopId === 1);
  const out = row(4, "Out of stock product", 2, null);
  out.prices[1].status = "Out of stock";
  const items = [missing, out, row(3, "Stale product", 2, null), row(1, "Compare product", 2, 5)];
  await page.route("**/api/shopping-lists**", route => route.fulfill({ json: route.request().url().endsWith("in-store")
    ? { id: 1, name: "Weekly shop", retailers: shops, items, remainingCount: 4, baskets: [], splitSubtotal: 16, splitPricedCount: 4, comparableCount: 0, comparableSplitSubtotal: 0 }
    : [{ id: 1, name: "Weekly shop", remainingCount: 4, retailers: shops }] }));
  await page.goto("/in-store");
  await page.getByLabel("Where are you shopping?").selectOption("2");
  await page.getByRole("button", { name: /Weekly shop/ }).click();
  const card = page.locator("article").filter({ hasText: "Compare product" });
  await expect(card.locator("p.text-2xl")).toContainText("$5.00");
  await expect(card).toContainText("Best price at Coles: $2.00 — $3.00 cheaper each. Save $6.00 on your quantity.");
  await expect(page.locator("article h4")).toHaveText(["Compare product", "Stale product", "Missing product", "Out of stock product"]);
  await expect(page.locator("article").filter({ hasText: "Missing product" })).toHaveClass(/bg-red-50/);
  await expect(page.getByText("Not found at Woolworths", { exact: true })).toBeVisible();
  await expect(page.getByText("Out of stock at Woolworths", { exact: true })).toBeVisible();
  await expect(page.getByText("Price unavailable at Woolworths", { exact: true })).toBeVisible();
  await page.getByLabel("Where are you shopping?").selectOption("1");
  await expect(card.locator("p.text-2xl")).toContainText("$2.00");
});
