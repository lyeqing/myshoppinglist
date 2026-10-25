import { test, expect, type Page } from "@playwright/test";
import type {
  ListItem,
  PlanningPrice,
  PriceRefreshResult,
} from "../src/lib/api-types";

const now = new Date("2026-10-17T04:00:00Z");
const today = "2026-10-17T03:00:00Z";
const yesterday = "2026-10-16T03:00:00Z";
const unavailableNotice =
  "1 checked today, but no current comparable price is available.";
const currentNotice = "1 current price already checked today.";
type Scenario =
  | "unavailable"
  | "mixed"
  | "queued"
  | "deferred"
  | "legacy"
  | "failure";
const item: ListItem = {
  id: 1,
  shoppingListId: 1,
  product: {
    id: 1,
    name: "Refresh coffee 500g",
    brand: "Acme",
    variant: null,
    packQuantity: null,
    packSize: 500,
    packUnit: "g",
    imageUrl: null,
  },
  quantity: 2,
  notes: "Keep my usual coffee",
  isPurchased: false,
  purchasedDate: null,
  isHidden: false,
  preferredShopId: null,
  addedDate: yesterday,
  updatedDate: yesterday,
};

async function fixture(page: Page, scenario: Scenario) {
  await page.clock.setFixedTime(now);
  const available: PlanningPrice = {
    shopId: 1,
    shopName: "Coles",
    price: 10,
    includedInTotal: true,
    status: "Fresh",
    productUrl: "https://www.coles.com.au/product/123456789",
    checkedDate: yesterday,
    specialDescription: null,
    observation: {
      sourceType: "RetailerPage",
      priceScope: "National",
      sourceUrl: null,
    },
  };
  const unavailable: PlanningPrice = {
    ...available,
    shopId: 2,
    shopName: "Woolworths",
    price: 25,
    includedInTotal: false,
    status: "Out of stock",
    checkedDate: today,
    productUrl: "https://www.woolworths.com.au/shop/productdetails/123456789",
  };
  const prices =
    scenario === "unavailable"
      ? [unavailable]
      : scenario === "legacy" || scenario === "failure"
      ? [available]
      : [available, unavailable];
  if (scenario === "mixed") available.checkedDate = today;
  const result: PriceRefreshResult =
    scenario === "unavailable"
      ? {
          queued: 0,
          alreadyRunning: 0,
          current: 0,
          deferred: 0,
          checkedUnavailable: 1,
        }
      : scenario === "mixed"
      ? {
          queued: 0,
          alreadyRunning: 0,
          current: 1,
          deferred: 0,
          checkedUnavailable: 1,
        }
      : scenario === "queued"
      ? {
          queued: 1,
          alreadyRunning: 0,
          current: 0,
          deferred: 0,
          checkedUnavailable: 1,
        }
      : scenario === "deferred"
      ? {
          queued: 0,
          alreadyRunning: 0,
          current: 0,
          deferred: 1,
          checkedUnavailable: 1,
        }
      : { queued: 0, alreadyRunning: 0, current: 1, deferred: 0 };
  const state = {
    requests: [] as string[],
    prices,
    result,
    planRequests: 0,
    planGate: null as Promise<void> | null,
    refreshGate: null as Promise<void> | null,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown) => route.fulfill({ json });
    if (
      route.request().method() === "POST" &&
      path.endsWith("/refresh-prices")
    ) {
      state.requests.push(path);
      await state.refreshGate;
      if (scenario === "failure")
        return route.fulfill({ status: 503, json: { title: "Unavailable" } });
      if (scenario === "legacy") available.checkedDate = today;
      if (scenario === "queued") available.refreshStatus = "Waiting";
      return send(state.result);
    }
    if (path.endsWith("/auth/me"))
      return send({
        account: { id: 1, displayName: "Alex", isTrial: false, isPaid: false },
        shoppingListId: 1,
      });
    if (path.endsWith("/manage"))
      return send({
        isPaid: false,
        limit: 2,
        lists: [
          {
            id: 1,
            name: "Weekly",
            createdDate: yesterday,
            updatedDate: yesterday,
          },
        ],
      });
    if (path.endsWith("/imports"))
      return send({ items: [], nextBeforeId: null });
    const shops = state.prices.map((p) => ({ id: p.shopId, name: p.shopName }));
    const subtotal = state.prices.some((p) => p.includedInTotal) ? 20 : 0;
    if (path.endsWith("/plan")) {
      state.planRequests++;
      await state.planGate;
      return send({
        id: 1,
        name: "Weekly",
        items: [{ item, prices: state.prices }],
        lowest: {
          shopId: null,
          name: "Lowest total across shops",
          subtotal,
          pricedCount: subtotal ? 1 : 0,
          missingItems: [],
        },
        retailers: [],
      });
    }
    if (path.endsWith("/items"))
      return send({ items: [item], nextBeforeId: null });
    if (path.endsWith("/in-store"))
      return send({
        id: 1,
        name: "Weekly",
        retailers: shops,
        remainingCount: 1,
        items: [
          {
            item,
            prices: state.prices.map((p) => ({
              ...p,
              price: p.includedInTotal ? p.price : null,
              previousPrice: p.includedInTotal ? null : p.price,
            })),
          },
        ],
        baskets: shops.map((s) => ({
          shopId: s.id,
          shopName: s.name,
          subtotal: state.prices.find((p) => p.shopId === s.id)!.includedInTotal
            ? 20
            : 0,
          pricedCount: state.prices.find((p) => p.shopId === s.id)!
            .includedInTotal
            ? 1
            : 0,
          comparableSubtotal: 0,
          savingsBySplitting: 0,
        })),
        splitSubtotal: subtotal,
        splitPricedCount: subtotal ? 1 : 0,
        comparableCount: 0,
        comparableSplitSubtotal: 0,
      });
    if (path === "/api/shopping-lists")
      return send([
        { id: 1, name: "Weekly", remainingCount: 1, retailers: shops },
      ]);
    return route.fulfill({ status: 404 });
  });
  return state;
}


for (const view of ["planning", "in-store"]) {
  test(view + ": saved observations can be reloaded without collection or idle polling", async ({ page }) => {
    const state = await fixture(page, "mixed");
    await page.goto(view === "planning" ? "/" : "/in-store");
    if(view === "in-store") await page.getByRole("button", {name:/Weekly/}).click();
    await expect(page.getByRole("article").first()).toBeVisible();
    await expect(page.getByRole("button", {name:/Refresh list prices|Refresh price|Retry comparison/})).toHaveCount(0);
    await page.getByRole("button", {name:"Refresh items",exact:true}).click();
    expect(state.requests).toEqual([]);
    await page.clock.install();
    const reads=state.planRequests;
    await page.clock.fastForward(65000);
    expect(state.planRequests).toBe(reads);
    expect(state.requests).toEqual([]);
  });
}
