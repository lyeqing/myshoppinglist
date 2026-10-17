import { test, expect, type Page } from "@playwright/test";
import type {
  BrandAlternative,
  ListItem,
  PackAlternative,
  PlanningPrice,
  PriceObservationContext,
} from "../src/lib/api-types";

const now = new Date("2026-10-17T04:00:00Z");
const stamp = "2026-10-17T03:00:00Z";
const originalSource = "https://www.coles.com.au/product/original-observation";
const offerSource = "https://www.woolworths.com.au/shop/productdetails/222222";
const originalContext = (): PriceObservationContext => ({
  sourceType: "RetailerPage",
  priceScope: "National",
  sourceUrl: originalSource,
});
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
  addedDate: stamp,
  updatedDate: stamp,
};

async function fixture(page: Page) {
  await page.clock.setFixedTime(now);
  const price: PlanningPrice = {
    shopId: 1,
    shopName: "Coles",
    price: 10,
    status: "Fresh",
    includedInTotal: true,
    checkedDate: stamp,
    productUrl: "https://www.coles.com.au/product/mapping-link",
    specialDescription: null,
    observation: originalContext(),
  };
  const baseline = {
    shopId: 1,
    shopName: "Coles",
    price: 10,
    unitPrice: 2,
    status: "Fresh",
    checkedDate: stamp,
    productUrl: price.productUrl,
    observation: originalContext(),
  };
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
    offer: {
      shopId: 2,
      shopName: "Woolworths",
      price: 13,
      unitPrice: 1.3,
      status: "Fresh",
      checkedDate: stamp,
      productUrl: "https://www.woolworths.com.au/shop/productdetails/111111",
      observation: {
        sourceType: "BrowserExtension",
        priceScope: "Online",
        sourceUrl: offerSource,
      },
    },
    original: baseline,
    unitPriceDifferencePercent: -35,
    packagePriceDifference: 3,
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
      status: "Not comparable",
      checkedDate: "2026-10-12T03:00:00Z",
      observation: {
        sourceType: "Manual",
        priceScope: "Catalogue",
        sourceUrl: null,
      },
    },
    original: { ...baseline },
    unitPriceDifferencePercent: null,
    packagePriceDifference: null,
  };
  const state = {
    price,
    pack,
    brand,
    previousPrice: null as number | null,
    writes: 0,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!["GET", "HEAD"].includes(route.request().method())) state.writes++;
    const send = (json: unknown) => route.fulfill({ json });
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
          { id: 1, name: "Weekly", createdDate: stamp, updatedDate: stamp },
        ],
      });
    if (path.endsWith("/imports"))
      return send({ items: [], nextBeforeId: null });
    const row = {
      item,
      prices: [{ ...state.price, previousPrice: state.previousPrice }],
      packAlternatives: [state.pack],
      brandAlternatives: [state.brand],
    };
    const subtotal = state.price.includedInTotal ? 20 : 0;
    if (path.endsWith("/plan"))
      return send({
        id: 1,
        name: "Weekly",
        items: [row],
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
        items: [row],
        retailers: [{ id: 1, name: "Coles" }],
        remainingCount: 1,
        baskets: [
          {
            shopId: 1,
            shopName: "Coles",
            subtotal,
            pricedCount: subtotal ? 1 : 0,
            comparableSubtotal: 0,
            savingsBySplitting: 0,
          },
        ],
        splitSubtotal: subtotal,
        splitPricedCount: subtotal ? 1 : 0,
        comparableCount: 0,
        comparableSplitSubtotal: 0,
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
    return route.fulfill({ status: 404 });
  });
  return state;
}
async function open(page: Page, view: string) {
  await page.goto(view === "planning" ? "/" : "/in-store");
  if (view === "in-store")
    await page.getByRole("button", { name: /Weekly/ }).click();
  await expect(page.getByRole("article")).toBeVisible();
}
const sizes = (page: Page) =>
  page.getByRole("region", { name: "Other package sizes", exact: true });
const brands = (page: Page) =>
  page.getByRole("region", { name: "Alternative brands", exact: true });
const sourceLinks = (page: Page) =>
  page.getByRole("link", { name: /View price source/ });

for (const view of ["planning", "in-store"]) {
  test(`${view} associates provenance with each price, retains dates and totals, and supports keyboard links`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = await fixture(page);
    await open(page, view);
    await expect(
      page.getByText("Source: Retailer website · National price", {
        exact: true,
      })
    ).toHaveCount(3);
    await expect(
      sizes(page).getByText("Source: Shared observation · Online price", {
        exact: true,
      })
    ).toBeVisible();
    await expect(
      brands(page).getByText("Source: Manually recorded · Catalogue price", {
        exact: true,
      })
    ).toBeVisible();
    await expect(
      sizes(page).getByText("Price up to date", { exact: true })
    ).toHaveCount(2);
    await expect(
      brands(page).getByText(/Last checked.*12 Oct 2026.*Not comparable/)
    ).toBeVisible();
    await expect(
      sizes(page).getByText(
        "35% less per 100 g; costs $3.00 more per package.",
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      brands(page).getByText(/A unit-price difference needs/)
    ).toBeVisible();
    const originalLink = sourceLinks(page)
      .filter({ hasText: "at Coles" })
      .first();
    await expect(originalLink).toHaveAttribute("href", originalSource);
    const offerLink = sizes(page).getByRole("link", {
      name: /View price source at Woolworths/,
    });
    await expect(offerLink).toHaveAttribute("href", offerSource);
    await expect(offerLink).toHaveAttribute("target", "_blank");
    await expect(offerLink).toHaveAttribute("rel", "noopener noreferrer");
    await offerLink.focus();
    await expect(offerLink).toBeFocused();
    expect((await offerLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(
      brands(page).getByRole("link", {
        name: /View price source at Woolworths/,
      })
    ).toHaveCount(0);
    await expect(page.getByText(/Keep my usual product/)).toBeVisible();
    await expect(
      page
        .getByRole("article")
        .getByText(/\$20\.00/)
        .first()
    ).toBeVisible();
    expect(state.writes).toBe(0);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: `test-results/${info.project.name}-provenance-${view}.png`,
      fullPage: true,
    });
  });

  test(`${view} shows unknown and missing metadata honestly without inventing source links`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.price.observation = {
      sourceType: "FutureSource",
      priceScope: "FutureScope",
      sourceUrl: null,
    };
    state.pack.offer.observation = {
      sourceType: "Other",
      priceScope: "Unknown",
      sourceUrl: null,
    };
    state.pack.original!.observation = undefined;
    state.brand.original!.observation = null;
    await open(page, view);
    await expect(
      page.getByText(
        "Source: Source unavailable · Coverage unknown — estimate",
        { exact: true }
      )
    ).toHaveCount(4);
    await expect(sourceLinks(page)).toHaveCount(0);
    await expect(page.getByText(/FutureSource|FutureScope/)).toHaveCount(0);
    await expect(
      sizes(page).getByRole("link", { name: "Check this size at Woolworths" })
    ).toHaveAttribute("href", state.pack.offer.productUrl!);
    await expect(
      page
        .getByRole("article")
        .getByText(/\$20\.00/)
        .first()
    ).toBeVisible();
    expect(state.writes).toBe(0);
  });

  test(`${view} labels branch and in-store coverage without implying a current general price`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.price.price = null;
    state.price.status = "Not comparable";
    state.price.includedInTotal = false;
    state.previousPrice = 10;
    state.price.observation = {
      sourceType: "Manual",
      priceScope: "StoreSpecific",
      sourceUrl: null,
    };
    state.pack.offer.status = "Not comparable";
    state.pack.offer.observation!.priceScope = "InStore";
    state.pack.unitPriceDifferencePercent = null;
    state.pack.packagePriceDifference = null;
    await open(page, view);
    await expect(
      page.getByText("Source: Manually recorded · Branch-specific price", {
        exact: true,
      })
    ).toBeVisible();
    await expect(
      sizes(page).getByText("Source: Shared observation · In-store price", {
        exact: true,
      })
    ).toBeVisible();
    await expect(sizes(page).getByText(/35% less/)).toHaveCount(0);
    if (view === "in-store")
      await expect(
        page.getByText("Previous observed price: $10.00 · Not comparable", {
          exact: true,
        })
      ).toBeVisible();
    else
      await expect(
        page.getByText("No current comparable price available.", {
          exact: true,
        })
      ).toBeVisible();
    expect(state.writes).toBe(0);
  });

  test(`${view} does not manufacture provenance for a missing observation or date`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.price.price = null;
    state.price.checkedDate = null;
    state.price.status = "No price";
    state.price.includedInTotal = false;
    state.price.observation = null;
    state.pack.original = null;
    state.brand.original = null;
    await open(page, view);
    await expect(
      page.getByText("Price check date unavailable", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Source: Source unavailable · Coverage unknown — estimate",
        { exact: true }
      )
    ).toHaveCount(0);
    await expect(sourceLinks(page)).toHaveCount(1);
    expect(state.writes).toBe(0);
  });

  for (const [sourceType, label] of [
    ["StructuredData", "Retailer website"],
    ["RetailerEndpoint", "Retailer website"],
    ["Playwright", "Retailer website"],
  ]) {
    test(`${view} describes ${sourceType} in customer language`, async ({
      page,
    }) => {
      const state = await fixture(page);
      state.pack.offer.observation = {
        sourceType,
        priceScope: "Online",
        sourceUrl: null,
      };
      await open(page, view);
      await expect(
        sizes(page).getByText(`Source: ${label} · Online price`, {
          exact: true,
        })
      ).toBeVisible();
      expect(state.writes).toBe(0);
    });
  }

  for (const [name, url] of [
    ["external host", "https://www.coles.com.au.evil.test/product/coffee"],
    ["credentials", "https://user:private@www.coles.com.au/product/coffee"],
    ["empty credentials", "https://@www.coles.com.au/product/coffee"],
    ["http", "http://www.coles.com.au/product/coffee"],
    ["account page", "https://www.coles.com.au/account/private-customer"],
    ["endpoint", "https://www.coles.com.au/api/products/private-customer"],
    ["custom port", "https://www.coles.com.au:8443/product/coffee"],
    ["invalid URL", "javascript:alert(1)"],
  ]) {
    test(`${view} omits ${name} source links while retaining provenance`, async ({
      page,
    }) => {
      const state = await fixture(page);
      state.pack.offer.observation!.sourceUrl = url;
      await open(page, view);
      await expect(
        sizes(page).getByText("Source: Shared observation · Online price", {
          exact: true,
        })
      ).toBeVisible();
      await expect(
        sizes(page).getByRole("link", {
          name: /View price source at Woolworths/,
        })
      ).toHaveCount(0);
      expect(state.writes).toBe(0);
    });
  }

  test(`${view} strips private query parameters and fragments from source links`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.pack.offer.observation!.sourceUrl =
      offerSource + "?token=private&userId=42#secret";
    await open(page, view);
    const link = sizes(page).getByRole("link", {
      name: /View price source at Woolworths/,
    });
    await expect(link).toHaveAttribute("href", offerSource);
    expect(await link.evaluate((element) => element.outerHTML)).not.toMatch(
      /token=|userId=|#secret/
    );
    expect(state.writes).toBe(0);
  });
}
