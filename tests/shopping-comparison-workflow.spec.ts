import { test, expect, type Page } from "@playwright/test";
import type {
  ShoppingPreferences,
  ListItem,
  PlanningPrice,
  PackAlternative,
  BrandAlternative,
} from "../src/lib/api-types";

test.setTimeout(120_000);
const today = "2026-10-17T03:00:00Z";
const yesterday = "2026-10-16T03:00:00Z";
const branch = {
  id: 91,
  shopId: 1,
  shopName: "Coles",
  storeCode: "C91",
  name: "Fixture Marion",
  address1: "1 Fixture Street",
  address2: null,
  suburb: "Marion",
  state: "SA",
  postcode: "5043",
  verifiedAt: today,
  branchPricesSupported: false,
};
const shops: ShoppingPreferences["availableShops"] = [
  { id: 1, name: "Coles", code: "coles", comparisonSupported: true },
  { id: 2, name: "Woolworths", code: "woolworths", comparisonSupported: true },
  {
    id: 3,
    name: "ALDI",
    code: "aldi",
    comparisonSupported: false,
    capabilityStatus: "Restricted",
    capabilityMessage:
      "Automatic product imports and price checks are unavailable for ALDI.",
  },
];
const item: ListItem = {
  id: 1,
  shoppingListId: 1,
  product: {
    id: 1,
    name: "Acme Original Coffee 500g",
    brand: "Acme",
    variant: null,
    packQuantity: null,
    packSize: 500,
    packUnit: "g",
    imageUrl: null,
  },
  quantity: 2,
  notes: "Keep my usual product",
  isPurchased: false,
  purchasedDate: null,
  isHidden: false,
  preferredShopId: null,
  addedDate: today,
  updatedDate: today,
};
function profile(accountId: number): ShoppingPreferences {
  return {
    accountId,
    compareOnlyPreferredShops: true,
    includeDifferentPackSizes: true,
    includeDifferentBrands: false,
    shops: [
      { shopId: 1, isEnabled: true },
      { shopId: 2, isEnabled: false },
      { shopId: 3, isEnabled: false },
    ],
    branches: [],
    availableShops: shops,
    updatedDate: today,
  };
}
async function fixture(page: Page, trial: boolean) {
  await page.clock.setFixedTime(new Date("2026-10-17T04:00:00Z"));
  const state = {
    account: 1,
    profiles: new Map([
      [1, profile(1)],
      [2, profile(2)],
    ]),
    old: false,
    pending: false,
    refreshes: [] as string[],
    saves: [] as Record<string, unknown>[],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    const send = (json: unknown, status = 200) =>
      route.fulfill({ json, status });
    const prefs = state.profiles.get(state.account)!;
    if (path === "/api/auth/me")
      return send({
        account: {
          id: state.account,
          displayName: state.account === 1 ? "Alex" : "Other customer",
          isTrial: state.account === 1 && trial,
          isPaid: false,
          expiresDate:
            state.account === 1 && trial ? "2099-01-01T00:00:00Z" : null,
        },
        shoppingListId: state.account,
        sessionExpiresDate: "2099-01-01T00:00:00Z",
      });
    if (path === "/api/account/shopping-preferences") {
      if (method === "GET") return send(prefs);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.saves.push(body);
      if (
        body.expectedAccountId !== state.account ||
        body.expectedUpdatedDate !== prefs.updatedDate
      )
        return send({ title: "Reload settings before saving." }, 409);
      const selectedBranches = body.branches as
        | { shopLocationId: number }[]
        | undefined;
      const saved: ShoppingPreferences = {
        ...prefs,
        compareOnlyPreferredShops: Boolean(body.compareOnlyPreferredShops),
        includeDifferentPackSizes: Boolean(body.includeDifferentPackSizes),
        includeDifferentBrands: Boolean(body.includeDifferentBrands),
        shops: body.shops as ShoppingPreferences["shops"],
        branches:
          selectedBranches === undefined
            ? prefs.branches
            : selectedBranches.map(() => ({
                location: branch,
                isAvailable: true,
                unavailableReason: null,
              })),
        updatedDate: new Date(Date.parse(prefs.updatedDate) + 1).toISOString(),
      };
      state.profiles.set(state.account, saved);
      return send(saved);
    }
    if (path === "/api/shop-locations")
      return send({ items: [branch], hasMore: false });
    const allowed = shops.filter(
      (shop) =>
        !prefs.compareOnlyPreferredShops ||
        prefs.shops.some((s) => s.shopId === shop.id && s.isEnabled)
    );
    const hasColes = allowed.some((s) => s.id === 1),
      hasWoolworths = allowed.some((s) => s.id === 2);
    const subtotal = hasColes && state.account === 1 ? 20 : 0;
    if (path === "/api/shopping-lists/manage")
      return send({
        limit: 2,
        isPaid: false,
        lists: [
          {
            id: state.account,
            name: state.account === 1 ? "Weekly" : "Other list",
            createdDate: today,
            updatedDate: today,
          },
        ],
      });
    if (path === "/api/shopping-lists")
      return send([
        {
          id: state.account,
          name: state.account === 1 ? "Weekly" : "Other list",
          remainingCount: state.account === 1 ? 1 : 0,
          retailers: allowed,
        },
      ]);
    if (state.account !== 1 && path.startsWith("/api/shopping-lists/1/"))
      return send({ title: "Not found." }, 404);
    if (path.endsWith("/refresh-prices")) {
      state.refreshes.push(path);
      if (!hasColes && !hasWoolworths)
        return send({
          queued: 0,
          alreadyRunning: 0,
          current: 0,
          deferred: 0,
          checkedUnavailable: 0,
        });
      const running = state.pending;
      if (state.old && hasColes) state.pending = true;
      return send({
        queued: state.old && hasColes && !running ? 1 : 0,
        alreadyRunning: running && hasColes ? 1 : 0,
        current: !state.old && hasColes ? 1 : 0,
        deferred: 0,
        checkedUnavailable: hasWoolworths ? 1 : 0,
      });
    }
    if (path.endsWith("/imports"))
      return send({ items: [], nextBeforeId: null });
    if (path.endsWith("/items"))
      return send({
        items: state.account === 1 ? [item] : [],
        nextBeforeId: null,
      });
    const coles: PlanningPrice = {
      shopId: 1,
      shopName: "Coles",
      price: 10,
      status: "Fresh",
      includedInTotal: true,
      checkedDate: state.old ? yesterday : today,
      productUrl: "https://www.coles.com.au/product/coffee-111111",
      specialDescription: null,
      refreshStatus: state.pending ? "Waiting" : null,
      observation: {
        sourceType: "RetailerPage",
        priceScope: "Unknown",
        sourceUrl: "https://www.coles.com.au/product/observed-111111",
      },
    };
    const woolworths: PlanningPrice = {
      ...coles,
      shopId: 2,
      shopName: "Woolworths",
      price: 12,
      status: "Out of stock",
      includedInTotal: false,
      checkedDate: today,
      refreshStatus: null,
      productUrl: "https://www.woolworths.com.au/shop/productdetails/222222",
      observation: {
        sourceType: "RetailerPage",
        priceScope: "Online",
        sourceUrl: null,
      },
    };
    const baseline = hasColes ? { ...coles, unitPrice: 2 } : null;
    const pack: PackAlternative = {
      relationship: "SameProductDifferentSize",
      product: {
        ...item.product,
        id: 2,
        name: "Acme Original Coffee 1kg",
        packSize: 1,
        packUnit: "kg",
      },
      totalQuantity: 1000,
      unit: "g",
      quantityRatio: 2,
      original: baseline,
      offer: {
        shopId: 2,
        shopName: "Woolworths",
        price: 13,
        unitPrice: 1.3,
        status: "Fresh",
        checkedDate: today,
        productUrl: "https://www.woolworths.com.au/shop/productdetails/333333",
        observation: {
          sourceType: "BrowserExtension",
          priceScope: "Online",
          sourceUrl: "https://www.woolworths.com.au/shop/productdetails/333333",
        },
      },
      unitPriceDifferencePercent: baseline ? -35 : null,
      packagePriceDifference: baseline ? 3 : null,
    };
    const brand: BrandAlternative = {
      ...pack,
      relationship: "EquivalentDifferentBrand",
      label: "Similar product — different brand",
      product: {
        ...pack.product,
        id: 3,
        name: "Other Original Coffee 1kg",
        brand: "Other",
      },
      offer: {
        ...pack.offer,
        price: 14,
        unitPrice: 1.4,
        productUrl: "https://www.woolworths.com.au/shop/productdetails/444444",
        observation: {
          ...pack.offer.observation!,
          sourceUrl: "https://www.woolworths.com.au/shop/productdetails/444444",
        },
      },
      unitPriceDifferencePercent: baseline ? -30 : null,
      packagePriceDifference: baseline ? 4 : null,
    };
    const prices = [coles, woolworths].filter((p) =>
      allowed.some((s) => s.id === p.shopId)
    );
    const row = {
      item,
      prices,
      packAlternatives:
        hasWoolworths && prefs.includeDifferentPackSizes ? [pack] : [],
      brandAlternatives:
        hasWoolworths && prefs.includeDifferentBrands ? [brand] : [],
    };
    const rows = state.account === 1 ? [row] : [];
    const storeContext = {
      preferredOnly: prefs.compareOnlyPreferredShops,
      shopNames: allowed.map((s) => s.name),
      branches: prefs.branches?.map((b) => ({
        ...b,
        supermarketEnabled: allowed.some((s) => s.id === b.location.shopId),
      })),
    };
    if (path.endsWith("/plan"))
      return send({
        id: state.account,
        name: "Weekly",
        items: rows,
        lowest: {
          shopId: null,
          name: "Lowest total across shops",
          subtotal,
          pricedCount: subtotal ? 1 : 0,
          missingItems: [],
        },
        retailers: [],
        storeContext,
      });
    if (path.endsWith("/in-store"))
      return send({
        id: state.account,
        name: "Weekly",
        retailers: allowed,
        remainingCount: rows.length,
        items: rows.map((r) => ({
          ...r,
          prices: r.prices.map((p) => ({
            ...p,
            price: p.includedInTotal ? p.price : null,
            previousPrice: p.includedInTotal ? null : p.price,
          })),
        })),
        baskets: [],
        splitSubtotal: subtotal,
        splitPricedCount: subtotal ? 1 : 0,
        comparableCount: 0,
        comparableSplitSubtotal: 0,
        storeContext,
      });
    return send({ title: "Not found." }, 404);
  });
  return state;
}
const options = (page: Page) =>
  page.getByRole("region", { name: "Comparison options", exact: true });
const sizes = (page: Page) =>
  page.getByRole("region", { name: "Other package sizes", exact: true });
const brands = (page: Page) =>
  page.getByRole("region", { name: "Alternative brands", exact: true });
const context = (page: Page) =>
  page.getByRole("region", { name: "Comparison stores and branches" });
async function saveStores(page: Page) {
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByText(/My Stores saved/)).toBeVisible();
}
async function saveOptions(page: Page) {
  await options(page)
    .getByRole("button", { name: "Save comparison options" })
    .click();
  await expect(
    options(page).getByText("Comparison options saved.", { exact: true })
  ).toBeVisible();
}

for (const trial of [false, true]) {
  test(`${
    trial ? "trial" : "registered"
  } customer carries stores, alternatives, provenance and refresh outcomes across views`, async ({
    page,
  }, info) => {
    const state = await fixture(page, trial);
    await page.goto("/settings");
    await expect(
      page.getByRole("button", { name: "Save My Stores", exact: true })
    ).toBeEnabled();
    if (trial)
      await expect(
        page.getByText(/Settings are saved for this trial/)
      ).toBeVisible();
    await page
      .getByLabel("Search supermarket", { exact: true })
      .selectOption("1");
    await page
      .getByLabel("Branch name, suburb or postcode", { exact: true })
      .fill("5043");
    await page
      .getByRole("button", { name: "Search branches", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add Fixture Marion", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Show alternative brands", exact: true })
      .check();
    await saveStores(page);
    await page.getByRole("link", { name: "My lists", exact: true }).click();
    const card = page.getByRole("article");
    await expect(card).toBeVisible();
    await expect(sizes(page)).toHaveCount(0);
    await expect(brands(page)).toHaveCount(0);
    await expect(card.getByText(/Coverage unknown — estimate/)).toBeVisible();
    await expect(context(page)).toContainText(
      "Prices shown are not verified for your saved branches."
    );
    const summary = context(page).getByText("Saved branches (1)", {
      exact: true,
    });
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(
      context(page).getByText("1 Fixture Street, Marion, SA, 5043", {
        exact: true,
      })
    ).toBeVisible();
    await page.getByRole("link", { name: "My Stores", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Woolworths", exact: true })
      .check();
    await saveStores(page);
    await page.getByRole("link", { name: "My lists", exact: true }).click();
    await expect(sizes(page)).toBeVisible();
    await expect(brands(page)).toBeVisible();
    await expect(
      sizes(page).getByText(
        "35% less per 100 g; costs $3.00 more per package.",
        { exact: true }
      )
    ).toBeVisible();
    const source = sizes(page).getByRole("link", {
      name: /View price source at Woolworths/,
    });
    await expect(source).toHaveAttribute(
      "href",
      "https://www.woolworths.com.au/shop/productdetails/333333"
    );
    await expect(
      brands(page).getByRole("link", {
        name: /View price source at Woolworths/,
      })
    ).toHaveAttribute(
      "href",
      "https://www.woolworths.com.au/shop/productdetails/444444"
    );
    await source.focus();
    await expect(source).toBeFocused();
    await card.getByRole("button", { name: "Edit note", exact: true }).click();
    await card.getByLabel("Notes", { exact: true }).fill("Unsaved pantry note");
    await options(page)
      .getByText("Comparison options", { exact: true })
      .click();
    await options(page)
      .getByRole("checkbox", {
        name: "Show different package sizes",
        exact: true,
      })
      .uncheck();
    await saveOptions(page);
    await expect(sizes(page)).toHaveCount(0);
    await expect(brands(page)).toBeVisible();
    await expect(card.getByLabel("Notes", { exact: true })).toHaveValue(
      "Unsaved pantry note"
    );
    await options(page)
      .getByRole("checkbox", {
        name: "Show different package sizes",
        exact: true,
      })
      .check();
    await options(page)
      .getByRole("checkbox", { name: "Show alternative brands", exact: true })
      .uncheck();
    await saveOptions(page);
    await expect(sizes(page)).toBeVisible();
    await expect(brands(page)).toHaveCount(0);
    expect(state.profiles.get(1)!.branches?.[0].location.id).toBe(91);
    await card
      .getByRole("button", { name: "Refresh price", exact: true })
      .click();
    await expect(
      page.getByText(
        /1 current price already checked today.*1 checked today, but no current comparable price is available/
      )
    ).toBeVisible();
    state.old = true;
    await page
      .getByRole("button", { name: "Refresh items", exact: true })
      .click();
    await expect(
      card.getByText("Price last checked 16 Oct 2026", { exact: true }).first()
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Refresh list prices", exact: true })
      .click();
    await expect(
      page.getByText(
        /1 price check queued.*1 checked today, but no current comparable price is available/
      )
    ).toBeVisible();
    await expect(card.getByLabel("Notes", { exact: true })).toHaveValue(
      "Unsaved pantry note"
    );
    await expect(
      card.getByText("Price last checked 16 Oct 2026", { exact: true }).first()
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Shop in store", exact: true })
      .click();
    await page.getByRole("button", { name: /Weekly/ }).click();
    await expect(sizes(page)).toBeVisible();
    await expect(brands(page)).toHaveCount(0);
    await expect(
      card.getByText("Keep my usual product", { exact: true })
    ).toBeVisible();
    await expect(
      card.getByText(/Previous observed price: \$12\.00/)
    ).toBeVisible();
    await expect(card.getByText(/Waiting for price update/)).toBeVisible();
    await options(page)
      .getByText("Comparison options", { exact: true })
      .click();
    await options(page)
      .getByRole("checkbox", { name: "Show alternative brands", exact: true })
      .check();
    await saveOptions(page);
    await expect(sizes(page)).toBeVisible();
    await expect(brands(page)).toBeVisible();
    await expect(card.getByText(/\$20\.00/).first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: `test-results/${info.project.name}-${
        trial ? "trial" : "registered"
      }-combined-workflow.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "My Stores", exact: true }).click();
    await expect(
      page
        .getByRole("list", { name: "Selected branches" })
        .getByRole("listitem")
    ).toHaveCount(1);
    await page.getByRole("checkbox", { name: "Coles", exact: true }).uncheck();
    await page
      .getByRole("checkbox", { name: "Woolworths", exact: true })
      .uncheck();
    await page.getByRole("checkbox", { name: "ALDI", exact: true }).check();
    await expect(
      page.getByText(
        /Automatic comparisons are unavailable for your selected stores/
      )
    ).toBeVisible();
    await saveStores(page);
    await page.getByRole("link", { name: "My lists", exact: true }).click();
    await expect(
      card.getByText("No current comparable price available.", { exact: true })
    ).toBeVisible();
    await expect(sizes(page)).toHaveCount(0);
    await expect(brands(page)).toHaveCount(0);
    await expect(context(page)).toContainText("Comparing My Stores: ALDI");
    expect(state.refreshes).toEqual([
      "/api/shopping-lists/1/items/1/refresh-prices",
      "/api/shopping-lists/1/refresh-prices",
    ]);
    state.account = 2;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("myshoppinglist-session-changed"))
    );
    await expect(
      page.getByRole("group", { name: "Signed in as Other customer" })
    ).toBeVisible();
    await expect(
      page.getByText("Acme Original Coffee 500g", { exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByText(/Fixture Marion|Unsaved pantry note/)
    ).toHaveCount(0);
    await page.getByRole("link", { name: "My Stores", exact: true }).click();
    await expect(
      page.getByRole("checkbox", {
        name: "Show alternative brands",
        exact: true,
      })
    ).not.toBeChecked();
    await expect(
      page
        .getByRole("list", { name: "Selected branches" })
        .getByRole("listitem")
    ).toHaveCount(0);
    expect(state.saves).toHaveLength(6);
    expect(state.saves.every((s) => s.expectedAccountId === 1)).toBe(true);
    expect(item.quantity).toBe(2);
    expect(item.notes).toBe("Keep my usual product");
    await page.unrouteAll({ behavior: "wait" });
  });
}
