import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type {
  ShoppingPreferences,
  ShopLocationSummary,
} from "../src/lib/api-types";

const endpoint = "/api/account/shopping-preferences";
const shops = [
  { id: 1, name: "Coles", code: "coles", comparisonSupported: true },
  { id: 2, name: "Woolworths", code: "woolworths", comparisonSupported: true },
  { id: 3, name: "ALDI", code: "aldi", comparisonSupported: false },
];
const location = (
  id: number,
  name: string,
  shopId = 1,
): ShopLocationSummary => ({
  id,
  shopId,
  shopName: shops.find((s) => s.id === shopId)!.name,
  name,
  storeCode: `C${id}`,
  address1: `${id} Example Street`,
  address2: null,
  suburb: "Marion",
  state: "SA",
  postcode: "5043",
  verifiedAt: "2026-10-16T00:00:00Z",
  branchPricesSupported: false,
});
const catalogue = [
  location(1, "Marion Centre"),
  location(2, "Oaklands Park"),
  location(3, "Marion Woolworths", 2),
  location(4, "Marion ALDI", 3),
];
const defaults = (accountId = 1): ShoppingPreferences => ({
  accountId,
  compareOnlyPreferredShops: true,
  includeDifferentPackSizes: true,
  includeDifferentBrands: false,
  shops: [
    { shopId: 1, isEnabled: true },
    { shopId: 2, isEnabled: true },
  ],
  branches: [],
  availableShops: shops,
  updatedDate: "2026-10-17T01:00:00Z",
});
let server: Server;
let profiles: Map<number, ShoppingPreferences>;
let account: number,
  access: number,
  failure: number,
  searchFailure: number,
  writes: number;
let searches: string[];
let lastBody: { branches?: { shopId: number; shopLocationId: number }[] };
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (access !== 200)
      return send(access, { title: "Your session is unavailable." });
    if (url.pathname === "/api/auth/me")
      return send(200, {
        account: {
          id: account,
          displayName: "Customer",
          isTrial: false,
          expiresDate: null,
        },
        shoppingListId: 1,
        sessionExpiresDate: "2099-01-01T00:00:00Z",
      });
    if (url.pathname === endpoint) {
      if (req.method === "GET") return send(200, profiles.get(account));
      if (req.method === "PUT") {
        writes++;
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        lastBody = body;
        if (
          body.expectedAccountId !== account ||
          body.expectedUpdatedDate !== profiles.get(account)!.updatedDate
        )
          return send(409, {
            title:
              "Your settings changed. Reload settings before saving again.",
          });
        if (failure)
          return send(failure, {
            title:
              failure === 409
                ? "Your settings changed. Reload settings before saving again."
                : "A branch is unavailable. Remove it or choose another branch.",
          });
        const previous = profiles.get(account)!;
        const branches =
          body.branches === undefined
            ? previous.branches
            : body.branches.map(
                (b: { shopLocationId: number }) =>
                  previous.branches?.find(
                    (x) => x.location.id === b.shopLocationId,
                  ) ?? {
                    location: catalogue.find((x) => x.id === b.shopLocationId),
                    isAvailable: true,
                    unavailableReason: null,
                  },
              );
        const saved = {
          ...previous,
          shops: body.shops,
          branches,
          compareOnlyPreferredShops: body.compareOnlyPreferredShops,
          includeDifferentPackSizes: body.includeDifferentPackSizes,
          includeDifferentBrands: body.includeDifferentBrands,
          updatedDate: new Date(
            Date.parse(previous.updatedDate) + 1,
          ).toISOString(),
        };
        profiles.set(account, saved);
        return send(200, saved);
      }
    }
    if (url.pathname === "/api/shop-locations") {
      searches.push(url.search);
      if (searchFailure)
        return send(searchFailure, { title: "Branch directory unavailable." });
      const shopId = Number(url.searchParams.get("shopId")),
        query = (url.searchParams.get("search") ?? "").toLowerCase();
      return send(200, {
        items:
          query === "many"
            ? Array.from({ length: 50 }, (_, i) =>
                location(i + 100, `Branch ${i}`, shopId),
              )
            : catalogue.filter(
                (b) =>
                  b.shopId === shopId &&
                  (!query ||
                    `${b.name} ${b.suburb} ${b.postcode}`
                      .toLowerCase()
                      .includes(query)),
              ),
        hasMore: query === "many",
      });
    }
    return send(404, { title: "Not found." });
  });
  await new Promise<void>((resolve) =>
    server.listen(5499, "127.0.0.1", resolve),
  );
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
test.beforeEach(() => {
  profiles = new Map([
    [1, defaults()],
    [2, defaults(2)],
  ]);
  account = 1;
  access = 200;
  failure = 0;
  searchFailure = 0;
  writes = 0;
  searches = [];
  lastBody = {};
});
async function open(page: Page) {
  await page.goto("/settings");
  await expect(
    page.getByRole("button", { name: "Save My Stores", exact: true }),
  ).toBeEnabled();
}
async function search(page: Page, query = "", shop = "1") {
  await page
    .getByLabel("Search supermarket", { exact: true })
    .selectOption(shop);
  await page
    .getByLabel("Branch name, suburb or postcode", { exact: true })
    .fill(query);
  await page
    .getByRole("button", { name: "Search branches", exact: true })
    .click();
}
async function add(page: Page) {
  await open(page);
  await search(page);
  await page
    .getByRole("button", { name: "Add Marion Centre", exact: true })
    .click();
}
async function save(page: Page) {
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByText(/My Stores saved/)).toBeVisible();
}

test("multiple branches and supermarkets persist, prevent duplicates, and retain accurate price messaging", async ({
  page,
}, info) => {
  await add(page);
  await expect(
    page.getByRole("button", { name: "Marion Centre selected", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Add Oaklands Park", exact: true })
    .click();
  await search(page, "5043", "2");
  await page
    .getByRole("button", { name: "Add Marion Woolworths", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "Selected branches" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("region", { name: "Preferred branches" }),
  ).toContainText("Branch-specific prices are unavailable");
  await page.screenshot({
    path: `test-results/${info.project.name}-preferred-branches.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await save(page);
  expect(lastBody.branches).toEqual([
    { shopId: 1, shopLocationId: 1 },
    { shopId: 1, shopLocationId: 2 },
    { shopId: 2, shopLocationId: 3 },
  ]);
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Selected branches" }).getByRole("listitem"),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: "Remove Oaklands Park", exact: true })
    .click();
  await save(page);
  expect(profiles.get(1)!.branches?.map((b) => b.location.id)).toEqual([1, 3]);
});
test("disabled supermarkets retain branches and re-enabling restores branch search", async ({
  page,
}) => {
  await add(page);
  await page.getByRole("checkbox", { name: "Coles", exact: true }).uncheck();
  await expect(
    page.getByText(/Saved for later. Coles is not enabled/),
  ).toBeVisible();
  await save(page);
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Selected branches" }),
  ).toContainText("Marion Centre");
  await expect(
    page.getByLabel("Search supermarket", { exact: true }),
  ).toHaveValue("2");
  await page.getByRole("checkbox", { name: "Coles", exact: true }).check();
  await search(page);
  await expect(
    page.getByRole("button", { name: "Marion Centre selected", exact: true }),
  ).toBeDisabled();
});
test("unavailable branches, including inactive supermarkets, can be removed and replaced", async ({
  page,
}) => {
  profiles.get(1)!.branches = [
    {
      location: location(90, "Closed branch", 1),
      isAvailable: false,
      unavailableReason:
        "This branch is no longer available. Remove it or choose another branch.",
    },
    {
      location: {
        ...location(91, "Former supermarket"),
        shopId: 99,
        shopName: "Former retailer",
      },
      isAvailable: false,
      unavailableReason: "This branch is no longer available.",
    },
  ];
  await open(page);
  await expect(
    page.getByRole("list", { name: "Selected branches" }),
  ).toContainText("Former retailer");
  await page
    .getByRole("button", { name: "Remove Closed branch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove Former supermarket", exact: true })
    .click();
  await search(page, "Marion");
  await page
    .getByRole("button", { name: "Add Marion Centre", exact: true })
    .click();
  await save(page);
  expect(profiles.get(1)!.branches?.map((b) => b.location.id)).toEqual([1]);
  await page
    .getByRole("button", { name: "Remove Marion Centre", exact: true })
    .click();
  await save(page);
  expect(lastBody.branches).toEqual([]);
});
test("search supports blank browsing, names, suburb/postcode, empty and capped results", async ({
  page,
}) => {
  await open(page);
  expect(searches).toHaveLength(0);
  await search(page, "no match");
  await expect(page.getByText(/No verified branches found/)).toBeVisible();
  await search(page, "Oaklands");
  await expect(
    page.getByRole("button", { name: "Add Oaklands Park", exact: true }),
  ).toBeVisible();
  expect(searches.at(-1)).toBe("?shopId=1&search=Oaklands");
  await search(page, "many");
  await expect(page.getByText(/Showing the first 50 matches/)).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Branch search results" })
      .getByRole("listitem"),
  ).toHaveCount(50);
  await page
    .getByLabel("Branch name, suburb or postcode", { exact: true })
    .fill("x");
  await expect(
    page.getByRole("button", { name: "Search branches", exact: true }),
  ).toBeDisabled();
});
for (const status of [400, 409, 503])
  test(`save failure ${status} preserves selections and supports recovery`, async ({
    page,
  }) => {
    await add(page);
    failure = status;
    await page
      .getByRole("button", { name: "Save My Stores", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Selected branches" }),
    ).toContainText("Marion Centre");
    failure = 0;
    if (status === 409) {
      await expect(
        page.getByRole("button", { name: "Save My Stores", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Reload settings", exact: true })
        .click();
      await expect(
        page.getByRole("list", { name: "Selected branches" }),
      ).toHaveCount(0);
    } else {
      await save(page);
      expect(profiles.get(1)!.branches).toHaveLength(1);
    }
  });
test("directory failures can be retried without losing selected branches", async ({
  page,
}) => {
  await add(page);
  searchFailure = 503;
  await search(page, "Marion");
  await expect(
    page.getByRole("region", { name: "Preferred branches" }).getByRole("alert"),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Selected branches" }),
  ).toContainText("Marion Centre");
  searchFailure = 0;
  await page
    .getByRole("button", { name: "Search branches", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Marion Centre selected", exact: true }),
  ).toBeDisabled();
});
for (const status of [401, 403])
  test(`directory access loss ${status} clears private selections`, async ({
    page,
  }) => {
    await add(page);
    access = status;
    await search(page, "Marion");
    await expect(
      page.getByRole("link", { name: "Sign in or start a trial", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Selected branches" }),
    ).toHaveCount(0);
  });
test("account switches prevent old branch drafts being saved to another account", async ({
  page,
}) => {
  await add(page);
  account = 2;
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "Selected branches" }),
  ).toHaveCount(0);
  expect(writes).toBe(0);
  expect(profiles.get(2)!.branches).toEqual([]);
});
test("late search responses cannot restore another supermarket's results", async ({
  page,
}) => {
  await open(page);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    page.route("**/api/shop-locations?**", async (route) => {
      started();
      await gate;
      await route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [catalogue[0]], hasMore: false }),
        })
        .catch(() => {});
      resolve();
    });
  });
  await search(page);
  await seen;
  await page
    .getByLabel("Search supermarket", { exact: true })
    .selectOption("2");
  release();
  await completed;
  await expect(
    page.getByRole("list", { name: "Branch search results" }),
  ).toHaveCount(0);
});
test("session changes clear selected branches and pending search responses", async ({
  page,
}) => {
  await add(page);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    page.route("**/api/shop-locations?**", async (route) => {
      started();
      await gate;
      await route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [catalogue[0]], hasMore: false }),
        })
        .catch(() => {});
      resolve();
    });
  });
  await search(page);
  await seen;
  account = 2;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("myshoppinglist-session-changed")),
  );
  release();
  await completed;
  await expect(
    page.getByRole("list", { name: "Selected branches" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Branch search results" }),
  ).toHaveCount(0);
});
test("keyboard search does not submit settings and selections can be added with Enter", async ({
  page,
}) => {
  await open(page);
  const input = page.getByLabel("Branch name, suburb or postcode", {
    exact: true,
  });
  await input.fill("Marion");
  await input.press("Enter");
  const add = page.getByRole("button", {
    name: "Add Marion Centre",
    exact: true,
  });
  await expect(add).toBeVisible();
  expect(writes).toBe(0);
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("list", { name: "Selected branches" }),
  ).toContainText("Marion Centre");
  await save(page);
});
test("branch limit is visible and already-selected branches remain removable", async ({
  page,
}) => {
  profiles.get(1)!.branches = Array.from({ length: 100 }, (_, i) => ({
    location: location(i + 100, `Saved branch ${i}`),
    isAvailable: true,
    unavailableReason: null,
  }));
  await open(page);
  await expect(
    page.getByText(/reached the limit of 100 saved branches/),
  ).toBeVisible();
  await search(page);
  await expect(
    page.getByRole("button", { name: "Add Marion Centre", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Remove Saved branch 0", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add Marion Centre", exact: true }),
  ).toBeEnabled();
});
test("customer proxy validates queries and routes and accepts bounded selection payloads", async ({
  request,
}) => {
  for (const query of [
    "shopId=0",
    "shopId=1&shopId=2",
    "shopId=1&unknown=yes",
    `shopId=1&search=${"x".repeat(101)}`,
  ])
    expect((await request.get(`/api/shop-locations?${query}`)).status()).toBe(
      400,
    );
  expect(searches).toHaveLength(0);
  for (const method of ["post", "put", "delete"] as const)
    expect((await request[method]("/api/shop-locations")).status()).toBe(404);
  const result = await request.get("/api/shop-locations?shopId=1&search=5043");
  expect(result.status()).toBe(200);
  expect(result.headers()["cache-control"]).toBe("no-store");
  expect(searches).toEqual(["?shopId=1&search=5043"]);
  const body = {
    ...defaults(),
    expectedAccountId: 1,
    expectedUpdatedDate: defaults().updatedDate,
    branches: Array.from({ length: 100 }, () => ({
      shopId: 1,
      shopLocationId: 1,
    })),
    ignored: "x".repeat(1000),
  };
  expect(JSON.stringify(body).length).toBeGreaterThan(4096);
  const response = await request.put(endpoint, {
    headers: { "X-MyShoppingList-Request": "1" },
    data: body,
  });
  expect(response.status()).toBe(200);
  expect(lastBody.branches).toHaveLength(100);
  expect(
    (
      await request.put(endpoint, {
        headers: { "X-MyShoppingList-Request": "1" },
        data: "x".repeat(16385),
      })
    ).status(),
  ).toBe(415);
});
