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
  const state = { requests: [] as string[], prices, result };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown) => route.fulfill({ json });
    if (
      route.request().method() === "POST" &&
      path.endsWith("/refresh-prices")
    ) {
      state.requests.push(path);
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
    if (path.endsWith("/plan"))
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
  for (const scope of ["product", "list"]) {
    for (const scenario of [
      "unavailable",
      "mixed",
      "queued",
      "deferred",
      "legacy",
      "failure",
    ] as const) {
      test(`${view} ${scope} refresh explains ${scenario} outcomes without changing saved prices`, async ({
        page,
      }, info) => {
        const state = await fixture(page, scenario);
        await page.goto(view === "planning" ? "/" : "/in-store");
        if (view === "in-store")
          await page.getByRole("button", { name: /Weekly/ }).click();
        const card = page.getByRole("article");
        await expect(card).toBeVisible();
        const before = state.prices.map((p) => ({
          price: p.price,
          checkedDate: p.checkedDate,
          scope: p.observation?.priceScope,
        }));
        const button =
          scope === "product"
            ? card.getByRole("button", { name: "Refresh price", exact: true })
            : page.getByRole("button", {
                name: "Refresh list prices",
                exact: true,
              });
        await expect(button).toBeEnabled();
        await button.click();
        await expect.poll(() => state.requests.length).toBe(1);
        expect(state.requests).toEqual([
          `/api/shopping-lists/1${
            scope === "product" ? "/items/1" : ""
          }/refresh-prices`,
        ]);
        if (scenario === "failure") {
          await expect(page.getByText(/temporarily unavailable/)).toBeVisible();
          await expect(
            page.getByText(unavailableNotice, { exact: true })
          ).toHaveCount(0);
        } else if (scenario === "legacy") {
          await expect(
            page.getByText(currentNotice, { exact: true })
          ).toBeVisible();
          await expect(
            card.getByText("Price up to date", { exact: true })
          ).toBeVisible();
          await expect(
            page.getByText(unavailableNotice, { exact: true })
          ).toHaveCount(0);
        } else {
          await expect(
            page.getByText(unavailableNotice, {
              exact: scenario === "unavailable",
            })
          ).toBeVisible();
          if (scenario === "mixed")
            await expect(
              page.getByText(currentNotice, { exact: false })
            ).toBeVisible();
          if (scenario === "queued")
            await expect(
              page.getByText(/1 price check queued\./)
            ).toBeVisible();
          if (scenario === "deferred")
            await expect(
              page.getByText(
                /1 deferred\. Refresh is unavailable or a retry limit applies/
              )
            ).toBeVisible();
          await expect(
            page.getByText("All prices up to date", { exact: true })
          ).toHaveCount(0);
          if (scenario !== "mixed")
            await expect(
              card.getByText("Price up to date", { exact: true })
            ).toHaveCount(0);
        }
        if (scenario !== "legacy") {
          expect(
            state.prices.map((p) => ({
              price: p.price,
              checkedDate: p.checkedDate,
              scope: p.observation?.priceScope,
            }))
          ).toEqual(before);
        }
        if (scenario !== "unavailable")
          await expect(card.getByText(/\$20\.00/).first()).toBeVisible();
        else
          await expect(
            card.getByText(
              /current comparable price available|fresh comparable price available/
            )
          ).toBeVisible();
        await expect(
          card.getByText("Keep my usual coffee", { exact: true })
        ).toBeVisible();
        if (["unavailable", "mixed", "queued", "deferred"].includes(scenario)) {
          await expect(
            card.getByText(/Last checked 17 Oct 2026/)
          ).toBeVisible();
          if (view === "in-store")
            await expect(
              card.getByText(/Previous observed price: \$25\.00/)
            ).toBeVisible();
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true);
        if (scope === "list" && scenario === "mixed")
          await page.screenshot({
            path: `test-results/${info.project.name}-refresh-outcome-${view}.png`,
            fullPage: true,
          });
        await page.unrouteAll({ behavior: "wait" });
      });
    }
  }
}
