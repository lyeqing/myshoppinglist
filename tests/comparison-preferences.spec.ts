import { test, expect, type Page } from "@playwright/test";
import type {
  ShoppingPreferences,
  ListItem,
  PackAlternative,
  BrandAlternative,
} from "../src/lib/api-types";

const stamp = new Date().toISOString();
const item: ListItem = {
  id: 1,
  shoppingListId: 1,
  product: {
    id: 1,
    name: "Acme Coffee 500g",
    brand: "Acme",
    variant: null,
    packQuantity: 1,
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
  addedDate: stamp,
  updatedDate: stamp,
};
const pack: PackAlternative = {
  relationship: "SameProductDifferentSize",
  product: { ...item.product, id: 2, name: "Acme Coffee 1kg", packSize: 1000 },
  totalQuantity: 1000,
  unit: "g",
  quantityRatio: 2,
  offer: {
    shopId: 1,
    shopName: "Coles",
    price: 15,
    unitPrice: 1.5,
    status: "Fresh",
    checkedDate: stamp,
    productUrl: "https://www.coles.com.au/product/123456",
  },
  original: null,
  unitPriceDifferencePercent: null,
  packagePriceDifference: null,
};
const brand: BrandAlternative = {
  ...pack,
  relationship: "EquivalentDifferentBrand",
  label: "Reviewed alternative",
  product: {
    ...item.product,
    id: 3,
    brand: "Other",
    name: "Other Coffee 500g",
  },
  totalQuantity: 500,
  quantityRatio: 1,
};
const defaults = (accountId = 1): ShoppingPreferences => ({
  accountId,
  compareOnlyPreferredShops: true,
  includeDifferentPackSizes: true,
  includeDifferentBrands: false,
  shops: [
    { shopId: 1, isEnabled: true },
    { shopId: 2, isEnabled: false },
  ],
  branches: [
    {
      location: {
        id: 91,
        shopId: 1,
        shopName: "Coles",
        storeCode: "C91",
        name: "Marion",
        address1: "1 Example Street",
        address2: null,
        suburb: "Marion",
        state: "SA",
        postcode: "5043",
        verifiedAt: stamp,
        branchPricesSupported: false,
      },
      isAvailable: true,
      unavailableReason: null,
    },
  ],
  availableShops: [
    { id: 1, name: "Coles", code: "coles", comparisonSupported: true },
    {
      id: 2,
      name: "Woolworths",
      code: "woolworths",
      comparisonSupported: true,
    },
  ],
  updatedDate: stamp,
});
const options = (page: Page) =>
  page.getByRole("region", { name: "Comparison options", exact: true });
const sizes = (page: Page) =>
  options(page).getByRole("checkbox", {
    name: "Show different package sizes",
    exact: true,
  });
const brands = (page: Page) =>
  options(page).getByRole("checkbox", {
    name: "Show alternative brands",
    exact: true,
  });
const apply = (page: Page) =>
  options(page).getByRole("button", {
    name: "Save comparison options",
    exact: true,
  });
async function fixture(page: Page) {
  const state = {
    profiles: new Map([
      [1, defaults()],
      [
        2,
        {
          ...defaults(2),
          includeDifferentPackSizes: false,
          includeDifferentBrands: true,
        },
      ],
    ]),
    account: 1,
    access: 200,
    getFailure: 0,
    saveFailure: 0,
    planFailure: 0,
    failReadAfterSave: false,
    switchOnWrite: false,
    preferenceReads: 0,
    planReads: 0,
    writes: [] as { path: string; body: Record<string, unknown> }[],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    const send = (json: unknown, status = 200) =>
      route.fulfill({ json, status });
    if (state.access !== 200)
      return send({ title: "Your session has ended." }, state.access);
    const prefs = state.profiles.get(state.account)!;
    if (path === "/api/auth/me")
      return send({
        account: {
          id: state.account,
          displayName: "Customer",
          isTrial: false,
          isPaid: false,
          expiresDate: null,
        },
        shoppingListId: 1,
        sessionExpiresDate: "2099-01-01T00:00:00Z",
      });
    if (method !== "GET") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.writes.push({ path, body });
      if (path !== "/api/account/shopping-preferences")
        return send({ title: "Unexpected write." }, 400);
      if (state.switchOnWrite) {
        state.account = 2;
        state.switchOnWrite = false;
      }
      if (
        body.expectedAccountId !== state.account ||
        body.expectedUpdatedDate !== prefs.updatedDate
      )
        return send(
          {
            title:
              "Your settings changed. Reload settings before saving again.",
          },
          409,
        );
      if (state.saveFailure)
        return send(
          {
            title:
              state.saveFailure === 409
                ? "Your settings changed. Reload settings before saving again."
                : "Could not save comparison options.",
          },
          state.saveFailure,
        );
      const saved = {
        ...prefs,
        includeDifferentPackSizes: Boolean(body.includeDifferentPackSizes),
        includeDifferentBrands: Boolean(body.includeDifferentBrands),
        shops: body.shops as ShoppingPreferences["shops"],
        updatedDate: new Date(Date.parse(prefs.updatedDate) + 1).toISOString(),
      };
      state.profiles.set(state.account, saved);
      if (state.failReadAfterSave) state.planFailure = 503;
      return send(saved);
    }
    if (path === "/api/account/shopping-preferences") {
      state.preferenceReads++;
      return state.getFailure
        ? send({ title: "Options unavailable." }, state.getFailure)
        : send(prefs);
    }
    if (path === "/api/shopping-lists/manage")
      return send({
        limit: 2,
        isPaid: false,
        lists: [
          { id: 1, name: "Weekly", createdDate: stamp, updatedDate: stamp },
        ],
      });
    if (path === "/api/shopping-lists")
      return send([
        {
          id: 1,
          name: "Weekly",
          remainingCount: 1,
          retailers: [{ id: 1, name: "Coles" }],
        },
      ]);
    if (path.endsWith("/imports"))
      return send({ items: [], nextBeforeId: null });
    if (path.endsWith("/items"))
      return send({ items: [item], nextBeforeId: null });
    if (path.endsWith("/pack-discovery"))
      return send({
        accountId: state.account,
        listId: 1,
        itemId: null,
        enabled: true,
        canStart: false,
        reason: "Saved alternatives available.",
        jobs: [],
        queued: 0,
        alreadyRunning: 0,
        recent: 0,
      });
    const row = {
      item,
      prices: [
        {
          shopId: 1,
          shopName: "Coles",
          price: 10,
          includedInTotal: true,
          status: "Fresh",
          productUrl: "https://www.coles.com.au/product/123456",
          checkedDate: stamp,
          specialDescription: null,
        },
      ],
      packAlternatives: prefs.includeDifferentPackSizes ? [pack] : [],
      brandAlternatives: prefs.includeDifferentBrands ? [brand] : [],
    };
    const storeContext = {
      preferredOnly: prefs.compareOnlyPreferredShops,
      shopNames: ["Coles"],
      branches: prefs.branches?.map((b) => ({
        ...b,
        supermarketEnabled: true,
      })),
    };
    if (path.endsWith("/plan") || path.endsWith("/in-store")) {
      state.planReads++;
      if (state.planFailure)
        return send(
          { title: "Comparison temporarily unavailable." },
          state.planFailure,
        );
    }
    if (path.endsWith("/plan"))
      return send({
        id: 1,
        name: "Weekly",
        items: [row],
        lowest: {
          shopId: null,
          name: "Lowest total across shops",
          subtotal: 20,
          pricedCount: 1,
          missingItems: [],
        },
        retailers: [
          {
            shopId: 1,
            name: "Coles",
            subtotal: 20,
            pricedCount: 1,
            missingItems: [],
          },
        ],
        storeContext,
      });
    if (path.endsWith("/in-store"))
      return send({
        id: 1,
        name: "Weekly",
        items: [row],
        retailers: [{ id: 1, name: "Coles" }],
        remainingCount: 1,
        baskets: [
          {
            shopId: 1,
            shopName: "Coles",
            subtotal: 20,
            pricedCount: 1,
            missingCount: 0,
            comparableSubtotal: 20,
            comparableCount: 1,
            savingsBySplitting: 0,
          },
        ],
        splitSubtotal: 20,
        splitPricedCount: 1,
        comparableCount: 1,
        comparableSplitSubtotal: 20,
        storeContext,
      });
    return send({ title: "Not found." }, 404);
  });
  return state;
}
async function open(page: Page, view: "list" | "in-store") {
  await page.goto(view === "list" ? "/" : "/in-store");
  if (view === "in-store")
    await page.getByRole("button", { name: /Weekly/ }).click();
  await expect(options(page)).toBeVisible();
}
async function expand(page: Page) {
  await options(page).getByText("Comparison options", { exact: true }).click();
}
async function saved(page: Page) {
  await apply(page).click();
  await expect(
    options(page).getByText("Comparison options saved.", { exact: true }),
  ).toBeVisible();
}
for (const view of ["list", "in-store"] as const) {
  test(`comparison options ${view}: independent toggles persist, refresh alternatives and preserve store and branch selections`, async ({
    page,
  }, info) => {
    const state = await fixture(page);
    await open(page, view);
    expect(state.preferenceReads).toBe(0);
    await expand(page);
    await expect(sizes(page)).toBeChecked();
    await expect(brands(page)).not.toBeChecked();
    const original = defaults();
    for (const [packEnabled, brandsEnabled] of [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ]) {
      await sizes(page).setChecked(packEnabled);
      await brands(page).setChecked(brandsEnabled);
      const count = state.writes.length;
      await saved(page);
      expect(state.writes).toHaveLength(count + 1);
      await expect(
        page.getByRole("region", { name: "Other package sizes", exact: true }),
      ).toHaveCount(packEnabled ? 1 : 0);
      await expect(
        page.getByRole("region", { name: "Alternative brands", exact: true }),
      ).toHaveCount(brandsEnabled ? 1 : 0);
      expect(state.writes.at(-1)!.body).toMatchObject({
        compareOnlyPreferredShops: true,
        shops: original.shops,
        branches: [{ shopId: 1, shopLocationId: 91 }],
      });
      expect(state.writes.at(-1)!.path).toBe(
        "/api/account/shopping-preferences",
      );
    }
    await page.screenshot({
      path: `test-results/${info.project.name}-${view}-comparison-options.png`,
      fullPage: true,
    });
    await options(page).screenshot({
      path: `test-results/${info.project.name}-${view}-comparison-options-panel.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.reload();
    if (view === "in-store")
      await page.getByRole("button", { name: /Weekly/ }).click();
    await expand(page);
    await expect(sizes(page)).toBeChecked();
    await expect(brands(page)).toBeChecked();
  });
  test(`comparison options ${view}: unavailable settings can be retried without blocking comparisons`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.getFailure = 503;
    await open(page, view);
    await expand(page);
    await expect(options(page).getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Other package sizes", exact: true }),
    ).toBeVisible();
    state.getFailure = 0;
    await options(page)
      .getByRole("button", {
        name: "Retry loading comparison options",
        exact: true,
      })
      .click();
    await expect(sizes(page)).toBeChecked();
  });
  test(`comparison options ${view}: save failures preserve the draft for retry`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await open(page, view);
    await expand(page);
    await brands(page).check();
    state.saveFailure = 503;
    await apply(page).click();
    await expect(options(page).getByRole("alert")).toBeVisible();
    await expect(brands(page)).toBeChecked();
    expect(state.profiles.get(1)!.includeDifferentBrands).toBe(false);
    state.saveFailure = 0;
    await saved(page);
    await expect(
      page.getByRole("region", { name: "Alternative brands", exact: true }),
    ).toBeVisible();
  });
  test(`comparison options ${view}: conflicting settings require reload and preserve other edits`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await open(page, view);
    await expand(page);
    await brands(page).check();
    state.profiles.get(1)!.updatedDate = new Date(
      Date.parse(stamp) + 100,
    ).toISOString();
    state.profiles.get(1)!.compareOnlyPreferredShops = false;
    await apply(page).click();
    await expect(options(page).getByRole("alert")).toContainText(
      "Your settings changed",
    );
    await expect(apply(page)).toBeDisabled();
    await options(page)
      .getByRole("button", { name: "Reload comparison options", exact: true })
      .click();
    await expect(brands(page)).not.toBeChecked();
    await brands(page).check();
    await saved(page);
    expect(state.writes.at(-1)!.body.compareOnlyPreferredShops).toBe(false);
  });
  test(`comparison options ${view}: a failed comparison reload retries without writing settings again`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await open(page, view);
    await expand(page);
    await brands(page).check();
    state.failReadAfterSave = true;
    await apply(page).click();
    await expect(options(page).getByRole("alert")).toContainText(
      "Options were saved, but comparisons could not be reloaded",
    );
    expect(state.writes).toHaveLength(1);
    expect(state.profiles.get(1)!.includeDifferentBrands).toBe(true);
    state.planFailure = 0;
    state.failReadAfterSave = false;
    await options(page)
      .getByRole("button", {
        name: "Retry refreshing comparisons",
        exact: true,
      })
      .click();
    await expect(
      options(page).getByText("Comparison options saved.", { exact: true }),
    ).toBeVisible();
    expect(state.writes).toHaveLength(1);
    await expect(
      page.getByRole("region", { name: "Alternative brands", exact: true }),
    ).toBeVisible();
  });
  test(`comparison options ${view}: account changes before save cannot write another customer's draft`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await open(page, view);
    await expand(page);
    await brands(page).check();
    state.account = 2;
    await apply(page).click();
    await expect(options(page).getByRole("checkbox")).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    expect(state.profiles.get(2)!.includeDifferentPackSizes).toBe(false);
  });
  test(`comparison options ${view}: session expiry clears private preference controls`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await open(page, view);
    await expand(page);
    await brands(page).check();
    state.access = 401;
    await apply(page).click();
    await expect(options(page).getByRole("checkbox")).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
  });
  test(`comparison options ${view}: keyboard changes require an explicit save`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await open(page, view);
    await expand(page);
    await expect(apply(page)).toBeDisabled();
    await brands(page).focus();
    await page.keyboard.press("Space");
    await expect(brands(page)).toBeChecked();
    expect(state.writes).toHaveLength(0);
    await page.keyboard.press("Tab");
    await expect(apply(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      options(page).getByText("Comparison options saved.", { exact: true }),
    ).toBeVisible();
    expect(state.writes).toHaveLength(1);
  });
}
test("comparison options list: saving alternatives retains an unsaved item note and quantity", async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page, "list");
  const card = page
    .getByRole("region", { name: "Editable shopping list", exact: true })
    .getByRole("article");
  await card.getByRole("button", { name: "Edit note", exact: true }).click();
  await card.getByLabel("Notes", { exact: true }).fill("Unsaved pantry note");
  await expand(page);
  await brands(page).check();
  await saved(page);
  await expect(card.getByLabel("Notes", { exact: true })).toHaveValue(
    "Unsaved pantry note",
  );
  await expect(card.getByLabel("Item quantity", { exact: true })).toHaveText(
    "2",
  );
  expect(
    state.writes.every(
      (write) => write.path === "/api/account/shopping-preferences",
    ),
  ).toBeTruthy();
  expect(item.notes).toBe("Keep my usual product");
});

for (const view of ["list", "in-store"] as const) {
  test(`comparison options ${view}: account switch during the write is rejected without overwriting preferences`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await open(page, view);
    await expand(page);
    await brands(page).check();
    state.switchOnWrite = true;
    await apply(page).click();
    await expect(options(page).getByRole("alert")).toContainText(
      "Your settings changed",
    );
    expect(state.profiles.get(2)!).toMatchObject({
      includeDifferentPackSizes: false,
      includeDifferentBrands: true,
    });
    await options(page)
      .getByRole("button", { name: "Reload comparison options", exact: true })
      .click();
    await expect(options(page).getByRole("checkbox")).toHaveCount(0);
  });
  test(`comparison options ${view}: session changes discard a late save response`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await open(page, view);
    await expand(page);
    await brands(page).check();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen = new Promise<void>((resolve) => {
      started = resolve;
    });
    let completed!: () => void;
    const done = new Promise<void>((resolve) => {
      completed = resolve;
    });
    await page.route("**/api/account/shopping-preferences", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      started();
      await gate;
      await route
        .fulfill({ json: { ...defaults(), includeDifferentBrands: true } })
        .catch(() => {});
      completed();
    });
    await apply(page).click();
    await seen;
    state.account = 2;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("myshoppinglist-session-changed")),
    );
    release();
    await done;
    await expect(
      options(page).getByText("Comparison options saved.", { exact: true }),
    ).toHaveCount(0);
    if (view === "in-store")
      await page.getByRole("button", { name: /Weekly/ }).click();
    await expand(page);
    await expect(sizes(page)).not.toBeChecked();
    await expect(brands(page)).toBeChecked();
  });
}
