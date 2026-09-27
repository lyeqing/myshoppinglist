import { test, expect } from "@playwright/test";
import { createInStoreStore, itemGroup } from "../src/stores/in-store-store";
import type { InStoreDetail, InStoreItem } from "../src/lib/api-types";

const shops = [{ id: 1, name: "Coles" }, { id: 2, name: "Woolworths" }];
function row(id: number, name: string, coles: number | null, woolworths: number | null): InStoreItem {
  return { item: { id, shoppingListId: 1, product: { id, name, brand: "Brand", variant: null, packQuantity: 1, packSize: 500, packUnit: "g", imageUrl: null },
    quantity: 2, notes: null, isPurchased: false, isHidden: false, purchasedDate: null, preferredShopId: null, addedDate: "2026-09-27T01:00:00Z", updatedDate: "2026-09-27T01:00:00Z" },
    prices: shops.map((s, i) => ({ shopId: s.id, shopName: s.name, price: i ? woolworths : coles, status: (i ? woolworths : coles) === null ? "Stale price" : "Fresh", checkedDate: "2026-09-27T01:00:00Z" })) };
}
test("groups all four retailer cases and unknown prices", () => {
  expect([row(1, "A", 2, 3), row(2, "B", 2, null), row(3, "C", 2, 2), row(4, "D", 3, 2), row(5, "E", null, null)].map(r => itemGroup(r, 1))).toEqual([0, 1, 2, 3, 4]);
  expect(itemGroup(row(6, "F", null, 2), 1)).toBe(3);
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
  await page.route("**/api/shopping-lists", route => route.fulfill({ status: 401, json: {} }));
  await page.goto("/in-store");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
});
