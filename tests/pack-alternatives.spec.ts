import { test, expect, type Page } from "@playwright/test";
import type { PackAlternative, ListItem } from "../src/lib/api-types";

const timestamp = "2026-10-16T01:00:00Z";
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
  notes: "Keep my usual size",
  isPurchased: false,
  purchasedDate: null,
  isHidden: false,
  preferredShopId: null,
  addedDate: timestamp,
  updatedDate: timestamp,
};
const alternative = (): PackAlternative => ({
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
    checkedDate: timestamp,
    productUrl: "https://www.woolworths.com.au/shop/productdetails/123456",
  },
  original: {
    shopId: 1,
    shopName: "Coles",
    price: 10,
    unitPrice: 2,
    status: "Fresh",
    checkedDate: timestamp,
    productUrl: "https://www.coles.com.au/product/123456",
  },
  unitPriceDifferencePercent: -35,
  packagePriceDifference: 3,
});
async function setup(page: Page, alternatives: PackAlternative[]) {
  let writes = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!["GET", "HEAD"].includes(route.request().method())) writes++;
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
          {
            id: 1,
            name: "Weekly",
            createdDate: timestamp,
            updatedDate: timestamp,
          },
        ],
      });
    if (path.endsWith("/imports"))
      return send({ items: [], nextBeforeId: null });
    const price = {
      shopId: 1,
      shopName: "Coles",
      price: 10,
      status: "Fresh",
      includedInTotal: true,
      checkedDate: timestamp,
      productUrl: "https://www.coles.com.au/product/123456",
      specialDescription: null,
    };
    const row = { item, prices: [price], packAlternatives: alternatives };
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
            subtotal: 20,
            pricedCount: 1,
            comparableSubtotal: 0,
            savingsBySplitting: 0,
          },
        ],
        splitSubtotal: 20,
        splitPricedCount: 1,
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
  return () => writes;
}
async function open(page: Page, view: string) {
  await page.goto(view === "planning" ? "/" : "/in-store");
  if (view === "in-store")
    await page.getByRole("button", { name: /Weekly/ }).click();
}
for (const view of ["planning", "in-store"]) {
  test(`${view} shows unit savings alongside higher package cost and preserves list`, async ({
    page,
  }, info) => {
    const writes = await setup(page, [alternative()]);
    await open(page, view);
    const section = page.getByRole("region", {
      name: "Other package sizes",
      exact: true,
    });
    await expect(section).toBeVisible();
    await expect(
      section.getByText("35% less per 100 g; costs $3.00 more per package.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      section.getByText(/1,000 g total per package · 2 ×/),
    ).toBeVisible();
    await expect(
      section.getByText(/Woolworths: \$13.00 per package · \$1.30 per 100 g/),
    ).toBeVisible();
    await expect(
      section.getByText(/Coles: \$10.00 per package · \$2.00 per 100 g/),
    ).toBeVisible();
    await expect(section.getByText(/Larger package: consider/)).toBeVisible();
    await expect(section.getByText(/Price last checked/)).toHaveCount(2);
    await expect(
      section.getByRole("link", { name: "Check this size at Woolworths" }),
    ).toHaveAttribute("href", /woolworths/);
    const settings = section.getByRole("link", {
      name: "Manage package-size comparisons",
    });
    await settings.focus();
    await expect(settings).toBeFocused();
    await expect(section.getByText("1 option", { exact: true })).toBeVisible();
    const toggle = section.getByRole("button", { name: "Hide other sizes", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.focus();
    await page.keyboard.press("Enter");
    const show = section.getByRole("button", { name: "Show other sizes", exact: true });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(section.getByText("Acme Original Coffee 1kg", { exact: true })).toBeHidden();
    await expect(settings).toBeHidden();
    await expect(section.getByText("1 option", { exact: true })).toBeVisible();
    const response = page.waitForResponse((response) =>
      response.url().endsWith(view === "planning" ? "/plan" : "/in-store"),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await response;
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(settings).toBeHidden();
    await show.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(section.getByText("Acme Original Coffee 1kg", { exact: true })).toBeVisible();
    await expect(settings).toBeVisible();
    await expect(
      page.getByText("Keep my usual size", { exact: true }),
    ).toBeVisible();
    expect(writes()).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/${info.project.name}-packs-${view}.png`,
      fullPage: true,
    });
  });
  test(`${view} omits alternatives when disabled or no saved matches exist`, async ({
    page,
  }) => {
    await setup(page, []);
    await open(page, view);
    await expect(page.getByRole("article")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Other package sizes", exact: true }),
    ).toHaveCount(0);
  });
}
test("stale prices have dates and no savings claim; missing baseline remains understandable", async ({
  page,
}) => {
  const stale = alternative();
  stale.offer.status = "Stale price";
  stale.offer.checkedDate = "2026-01-01T00:00:00Z";
  stale.unitPriceDifferencePercent = null;
  stale.packagePriceDifference = null;
  stale.offer.productUrl = "javascript:alert(1)";
  const missing = alternative();
  missing.product.id = 3;
  missing.product.name = "Acme Original Coffee 2kg";
  missing.original = null;
  missing.unitPriceDifferencePercent = null;
  missing.packagePriceDifference = null;
  await setup(page, [stale, missing]);
  await open(page, "planning");
  const section = page.getByRole("region", {
    name: "Other package sizes",
    exact: true,
  });
  await expect(section.getByText(/Stale price/)).toBeVisible();
  await expect(
    section.getByText(/Last checked.*2026.*Stale price/),
  ).toBeVisible();
  await expect(section.getByText(/A unit-price difference needs/)).toHaveCount(
    2,
  );
  await expect(section.getByText(/% less/)).toHaveCount(0);
  await expect(section.getByText("2 options", { exact: true })).toBeVisible();
  await expect(
    section.getByRole("link", { name: "Check this size at Woolworths" }),
  ).toHaveCount(1);
});
test("today's offer is up to date and very large packages remain factual", async ({
  page,
}) => {
  const large = alternative();
  large.quantityRatio = 2000;
  large.totalQuantity = 1000000;
  large.product.name = "Acme Original Coffee 1000kg";
  large.offer.checkedDate = new Date(Date.now() - 1000).toISOString();
  await setup(page, [large]);
  await open(page, "planning");
  const section = page.getByRole("region", {
    name: "Other package sizes",
    exact: true,
  });
  await expect(
    section.getByText("Price up to date", { exact: true }),
  ).toBeVisible();
  await expect(section.getByText(/2,000 × your original/)).toBeVisible();
  await expect(section.getByText(/possible waste before buying/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Hide other sizes", exact: true })).toHaveCount(1);
});
