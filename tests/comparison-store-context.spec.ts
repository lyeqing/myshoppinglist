import { test, expect, type Page } from "@playwright/test";
import type {
  ComparisonStoreContext,
  ComparisonBranchContext,
} from "../src/lib/api-types";

const branch = (
  id: number,
  name = "Marion",
  shopId = 1,
): ComparisonBranchContext => ({
  location: {
    id,
    shopId,
    shopName: shopId === 1 ? "Coles" : "Woolworths",
    storeCode: `B${id}`,
    name,
    address1: `${id} Example Street`,
    address2: null,
    suburb: "Marion",
    state: "SA",
    postcode: "5043",
    verifiedAt: "2026-10-16T00:00:00Z",
    branchPricesSupported: false,
  },
  isAvailable: true,
  unavailableReason: null,
  supermarketEnabled: true,
});
const context = (): ComparisonStoreContext => ({
  preferredOnly: true,
  shopNames: ["Coles", "Woolworths"],
  branches: [branch(1), branch(2)],
});
async function fixture(page: Page, initial: ComparisonStoreContext | null) {
  const state = {
    context: initial,
    account: 1,
    access: 200,
    failure: 0,
    writes: 0,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown, status = 200) =>
      route.fulfill({ status, json });
    if (route.request().method() !== "GET") {
      state.writes++;
      return send({ title: "No write expected." }, 400);
    }
    if (state.access !== 200)
      return send({ title: "Your session has ended." }, state.access);
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
    if (path === "/api/shopping-lists/manage")
      return send({
        limit: 2,
        isPaid: false,
        lists: [
          {
            id: 1,
            name: "Weekly",
            createdDate: "2026-10-17T00:00:00Z",
            updatedDate: "2026-10-17T00:00:00Z",
          },
        ],
      });
    if (path === "/api/shopping-lists")
      return send([
        {
          id: 1,
          name: "Weekly",
          remainingCount: 0,
          retailers: [{ id: 1, name: "Coles" }],
        },
      ]);
    if (path.endsWith("/imports"))
      return send({ items: [], nextBeforeId: null });
    if (path.endsWith("/items")) return send({ items: [], nextBeforeId: null });
    if (state.failure && (path.endsWith("/plan") || path.endsWith("/in-store")))
      return send({ title: "Could not load comparison." }, state.failure);
    if (path.endsWith("/plan"))
      return send({
        id: 1,
        name: "Weekly",
        items: [],
        lowest: {
          shopId: null,
          name: "Lowest total across shops",
          subtotal: 0,
          pricedCount: 0,
          missingItems: [],
        },
        retailers: [],
        storeContext: state.context,
      });
    if (path.endsWith("/in-store"))
      return send({
        id: 1,
        name: "Weekly",
        items: [],
        retailers: [{ id: 1, name: "Coles" }],
        remainingCount: 0,
        baskets: [],
        splitSubtotal: 0,
        splitPricedCount: 0,
        comparableCount: 0,
        comparableSplitSubtotal: 0,
        storeContext: state.context,
      });
    return send({ title: "Not found." }, 404);
  });
  return state;
}
const panel = (page: Page) =>
  page.getByRole("region", {
    name: "Comparison stores and branches",
    exact: true,
  });
async function open(page: Page, view: "list" | "in-store") {
  await page.goto(view === "list" ? "/" : "/in-store");
  if (view === "in-store")
    await page.getByRole("button", { name: /Weekly/ }).click();
}
async function reload(page: Page, view: "list" | "in-store") {
  await page
    .getByRole("button", {
      name: view === "list" ? "Refresh items" : "Refresh prices",
      exact: true,
    })
    .click();
}
for (const view of ["list", "in-store"] as const) {
  test(`${view}: compact branch summary expands with keyboard and distinguishes addresses`, async ({
    page,
  }, info) => {
    const state = await fixture(page, context());
    await open(page, view);
    await expect(panel(page)).toContainText(
      "Comparing My Stores: Coles, Woolworths",
    );
    await expect(panel(page)).toContainText(
      "Prices shown are not verified for your saved branches.",
    );
    await expect(
      panel(page).getByText("1 Example Street, Marion, SA, 5043", {
        exact: true,
      }),
    ).not.toBeVisible();
    const summary = panel(page).getByText("Saved branches (2)", {
      exact: true,
    });
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(
      panel(page).getByText("1 Example Street, Marion, SA, 5043", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      panel(page).getByText("2 Example Street, Marion, SA, 5043", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole("link", { name: "Manage My Stores", exact: true }),
    ).toHaveAttribute("href", "/settings");
    await page.screenshot({
      path: `test-results/${info.project.name}-${view}-branch-context.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(state.writes).toBe(0);
  });
  for (const empty of ["omitted", "null", "empty"] as const)
    test(`${view}: ${empty} branches retain the existing supermarket display`, async ({
      page,
    }) => {
      const value: ComparisonStoreContext = {
        preferredOnly: false,
        shopNames: ["Coles"],
        ...(empty === "omitted"
          ? {}
          : { branches: empty === "null" ? null : [] }),
      };
      await fixture(page, value);
      await open(page, view);
      await expect(panel(page)).toContainText("Comparing all supported stores");
      await expect(panel(page).getByText(/Saved branches/)).toHaveCount(0);
      await expect(
        panel(page).getByText(/Prices shown are not verified/),
      ).toHaveCount(0);
    });
  test(`${view}: unavailable branches and disabled supermarkets have separate clear statuses`, async ({
    page,
  }) => {
    const current = context();
    current.preferredOnly = false;
    current.branches = [
      {
        ...branch(1),
        isAvailable: false,
        unavailableReason:
          "This branch is no longer available. Remove it or choose another branch.",
      },
      { ...branch(2, "Other branch", 2), supermarketEnabled: false },
    ];
    await fixture(page, current);
    await open(page, view);
    await expect(panel(page)).toContainText("Comparing all supported stores");
    await expect(panel(page)).toContainText("1 saved branch is unavailable.");
    await expect(panel(page)).toContainText(
      "1 saved branch belongs to a supermarket that is not enabled in My Stores.",
    );
    await panel(page).getByText("Saved branches (2)", { exact: true }).click();
    await expect(
      panel(page).getByText(
        "This branch is no longer available. Remove it or choose another branch.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      panel(page).getByText(
        /Supermarket not enabled in My Stores. This branch selection is kept for later/,
      ),
    ).toBeVisible();
  });
  test(`${view}: refreshing comparisons replaces the branch context`, async ({
    page,
  }) => {
    const state = await fixture(page, context());
    await open(page, view);
    await expect(panel(page)).toContainText("Saved branches (2)");
    state.context = {
      preferredOnly: true,
      shopNames: ["Woolworths"],
      branches: [branch(3, "Brighton", 2)],
    };
    await reload(page, view);
    await expect(panel(page)).toContainText("Saved branches (1)");
    await panel(page).getByText("Saved branches (1)", { exact: true }).click();
    await expect(panel(page)).toContainText("Woolworths · Brighton");
    await expect(panel(page)).not.toContainText("Coles · Marion");
  });
  test(`${view}: expired sessions clear private branch information`, async ({
    page,
  }) => {
    const state = await fixture(page, context());
    await open(page, view);
    await expect(panel(page)).toBeVisible();
    state.access = 401;
    await reload(page, view);
    await expect(panel(page)).toHaveCount(0);
  });
  test(`${view}: session changes cannot retain the previous customer's branches`, async ({
    page,
  }) => {
    const state = await fixture(page, context());
    await open(page, view);
    await expect(panel(page)).toContainText("Saved branches (2)");
    state.account = 2;
    state.context = {
      preferredOnly: false,
      shopNames: ["Coles"],
      branches: [],
    };
    await page.evaluate(() =>
      window.dispatchEvent(new Event("myshoppinglist-session-changed")),
    );
    if (view === "in-store")
      await page.getByRole("button", { name: /Weekly/ }).click();
    await expect(panel(page)).toContainText("Comparing all supported stores");
    await expect(panel(page)).not.toContainText("Saved branches");
  });
  test(`${view}: long and special-character branch details render safely without overflow`, async ({
    page,
  }) => {
    const current = context();
    current.branches = [
      branch(
        1,
        '<img src=x onerror="window.branchInjected=true">' +
          "LongBranch".repeat(15),
      ),
    ];
    await fixture(page, current);
    await open(page, view);
    await panel(page).getByText("Saved branches (1)", { exact: true }).click();
    await expect(panel(page)).toContainText(
      '<img src=x onerror="window.branchInjected=true">',
    );
    await expect(panel(page).locator("img")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  });
}
