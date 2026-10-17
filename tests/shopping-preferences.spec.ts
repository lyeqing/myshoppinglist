import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { ShoppingPreferences } from "../src/lib/api-types";

const availableShops = [
  { id: 1, name: "Coles", code: "coles", comparisonSupported: true },
  { id: 2, name: "Woolworths", code: "woolworths", comparisonSupported: true },
  { id: 3, name: "ALDI", code: "aldi", comparisonSupported: false },
  { id: 4, name: "IGA", code: "iga", comparisonSupported: false },
  { id: 5, name: "Foodland", code: "foodland", comparisonSupported: false },
];
const defaults = (accountId = 1): ShoppingPreferences => ({
  accountId,
  compareOnlyPreferredShops: false,
  includeDifferentPackSizes: true,
  includeDifferentBrands: false,
  shops: [],
  availableShops,
  updatedDate: "2026-10-17T01:00:00.000Z",
});
let server: Server;
let profiles: Map<number, ShoppingPreferences>;
let account = 1;
let signedIn = true;
let trial = false;
let getFailure = 0;
let putFailure = 0;
let writes = 0;
let switchOnWrite = false;
const session = () => ({
  account: {
    id: account,
    displayName: `Shopper ${account}`,
    isTrial: trial,
    isPaid: false,
    expiresDate: null,
  },
  shoppingListId: 1,
  sessionExpiresDate: "2099-01-01T00:00:00Z",
});

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (!signedIn) return send(401, { title: "Your session has ended." });
    if (path === "/api/auth/me") return send(200, session());
    if (path === "/api/account/shopping-preferences") {
      if (req.method === "GET")
        return send(
          getFailure || 200,
          getFailure
            ? { title: "Settings unavailable" }
            : profiles.get(account),
        );
      if (req.method === "PUT") {
        writes++;
        if (switchOnWrite) {
          account = 2;
          switchOnWrite = false;
        }
        let raw = "";
        for await (const part of req) raw += part;
        const body = JSON.parse(raw);
        if (body.expectedAccountId !== account)
          return send(409, {
            title: "Your account changed. Reload settings before saving again.",
          });
        if (putFailure)
          return send(putFailure, {
            title:
              putFailure === 409
                ? "Your settings changed. Reload settings before saving again."
                : "Could not save settings.",
          });
        if (body.expectedUpdatedDate !== profiles.get(account)!.updatedDate)
          return send(409, { title: "Your settings changed." });
        const saved = {
          ...profiles.get(account)!,
          compareOnlyPreferredShops: body.compareOnlyPreferredShops,
          includeDifferentPackSizes: body.includeDifferentPackSizes,
          includeDifferentBrands: body.includeDifferentBrands,
          shops: body.shops,
          updatedDate: new Date(
            Date.parse(body.expectedUpdatedDate) + 1,
          ).toISOString(),
        };
        profiles.set(account, saved);
        return send(200, saved);
      }
    }
    const prefs = profiles.get(account)!;
    const selected = prefs.compareOnlyPreferredShops
      ? availableShops.filter((s) =>
          prefs.shops.some((p) => p.shopId === s.id && p.isEnabled),
        )
      : availableShops;
    const storeContext = {
      preferredOnly: prefs.compareOnlyPreferredShops,
      shopNames: selected.map((s) => s.name),
    };
    if (path === "/api/shopping-lists/manage")
      return send(200, {
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
    if (path === "/api/shopping-lists/1/imports")
      return send(200, { items: [], nextBeforeId: null });
    if (path === "/api/shopping-lists/1/plan")
      return send(200, {
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
        storeContext,
      });
    if (path === "/api/shopping-lists")
      return send(200, [
        {
          id: 1,
          name: "Weekly",
          remainingCount: 0,
          retailers: selected
            .filter((s) => s.comparisonSupported)
            .map((s) => ({ id: s.id, name: s.name })),
        },
      ]);
    if (path === "/api/shopping-lists/1/in-store")
      return send(200, {
        id: 1,
        name: "Weekly",
        items: [],
        retailers: selected
          .filter((s) => s.comparisonSupported)
          .map((s) => ({ id: s.id, name: s.name })),
        remainingCount: 0,
        baskets: [],
        splitSubtotal: 0,
        splitPricedCount: 0,
        comparableCount: 0,
        comparableSplitSubtotal: 0,
        storeContext,
      });
    return send(404, { title: "Not found" });
  });
  await new Promise<void>((resolve) =>
    server.listen(5499, "127.0.0.1", resolve),
  );
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
});
test.beforeEach(() => {
  profiles = new Map([
    [1, defaults()],
    [2, defaults(2)],
  ]);
  account = 1;
  signedIn = true;
  trial = false;
  getFailure = 0;
  putFailure = 0;
  writes = 0;
  switchOnWrite = false;
});

test("My Stores saves first selections, defaults to preferred-only and survives reload", async ({
  page,
}, info) => {
  trial = true;
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "My Stores", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Settings are saved for this trial/),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Compare only my stores", exact: true }),
  ).not.toBeChecked();
  const coles = page.getByRole("checkbox", { name: "Coles", exact: true });
  await coles.focus();
  await page.keyboard.press("Space");
  await expect(coles).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Compare only my stores", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByText(/My Stores saved/)).toBeVisible();
  expect(profiles.get(1)!.includeDifferentPackSizes).toBe(true);
  expect(profiles.get(1)!.includeDifferentBrands).toBe(false);
  await page.reload();
  await expect(coles).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Compare only my stores", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByText(/My Stores saved/)).toBeVisible();
  expect(profiles.get(1)!.compareOnlyPreferredShops).toBe(false);
  await page.screenshot({
    path: `test-results/${info.project.name}-my-stores.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("My Stores explains empty and unsupported-only selections", async ({
  page,
}) => {
  await page.goto("/settings");
  await page
    .getByRole("checkbox", { name: "Compare only my stores", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "Save My Stores", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Choose at least one store, or turn off Compare only my stores.",
    ),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "ALDI", exact: true }).check();
  await expect(
    page.getByText(/Your selected stores do not support comparisons yet/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByText(/My Stores saved/)).toBeVisible();
  expect(profiles.get(1)!.shops).toEqual([{ shopId: 3, isEnabled: true }]);
});

test("My Stores load and save failures can be retried without losing selections", async ({
  page,
}) => {
  getFailure = 503;
  await page.goto("/settings");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  getFailure = 0;
  await page.getByRole("button", { name: "Retry loading settings" }).click();
  await page.getByRole("checkbox", { name: "Woolworths", exact: true }).check();
  putFailure = 503;
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Woolworths", exact: true }),
  ).toBeChecked();
  putFailure = 0;
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByText(/My Stores saved/)).toBeVisible();
});

test("My Stores requires a reload after conflicting edits", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("checkbox", { name: "Coles", exact: true }).check();
  putFailure = 409;
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Your settings changed",
  );
  await expect(
    page.getByRole("button", { name: "Save My Stores", exact: true }),
  ).toBeDisabled();
  putFailure = 0;
  await page.getByRole("button", { name: "Reload settings" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Coles", exact: true }),
  ).not.toBeChecked();
});

test("My Stores clears private settings after expiry and rejects anonymous access", async ({
  page,
}) => {
  signedIn = false;
  await page.goto("/settings");
  await expect(
    page.getByRole("link", { name: "Sign in or start a trial" }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  signedIn = true;
  await page.reload();
  await page.getByRole("checkbox", { name: "Coles", exact: true }).check();
  signedIn = false;
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  expect(writes).toBe(0);
});

test("My Stores never saves an old account draft into a newly signed-in account", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("checkbox", { name: "Coles", exact: true }).check();
  account = 2;
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Coles", exact: true }),
  ).not.toBeChecked();
  expect(writes).toBe(0);
  expect(profiles.get(2)!.shops).toEqual([]);
});

test("My Stores proxy protects writes, content types and response caching", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(
    page.getByRole("checkbox", { name: "Coles", exact: true }),
  ).toBeVisible();
  const path = "/api/account/shopping-preferences";
  const body = {
    ...defaults(),
    expectedAccountId: 1,
    expectedUpdatedDate: defaults().updatedDate,
  };
  expect((await page.request.put(path, { data: body })).status()).toBe(403);
  const headers = { "X-MyShoppingList-Request": "1" };
  expect(
    (
      await page.request.put(path, {
        headers: { ...headers, Origin: "https://evil.example" },
        data: body,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.put(path, {
        headers: { ...headers, "Content-Type": "text/plain" },
        data: "{}",
      })
    ).status(),
  ).toBe(415);
  expect(
    (
      await page.request.put(path, {
        headers,
        data: { payload: "x".repeat(5000) },
      })
    ).status(),
  ).toBe(413);
  expect(
    (
      await page.request.put("/api/account/2/shopping-preferences", {
        headers,
        data: body,
      })
    ).status(),
  ).toBe(404);
  expect(writes).toBe(0);
  const response = await page.request.put(path, { headers, data: body });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("shopping views show the saved comparison scope and link to My Stores", async ({
  page,
}) => {
  profiles.set(1, {
    ...defaults(),
    compareOnlyPreferredShops: true,
    shops: [{ shopId: 2, isEnabled: true }],
  });
  await page.goto("/");
  await expect(page.getByText(/Comparing My Stores: Woolworths/)).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "My Stores", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Woolworths", exact: true }),
  ).toBeChecked();
  await page.goto("/in-store");
  await page.getByRole("button", { name: /Weekly/ }).click();
  await expect(page.getByText(/Comparing My Stores: Woolworths/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Manage My Stores" }),
  ).toBeVisible();
});

test("My Stores blocks an account switch between the identity check and the save", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("checkbox", { name: "Coles", exact: true }).check();
  switchOnWrite = true;
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Your account changed",
  );
  expect(profiles.get(2)!.shops).toEqual([]);
  await page.getByRole("button", { name: "Reload settings" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Coles", exact: true }),
  ).not.toBeChecked();
});

test("package size preference persists independently of store selection and brand preference", async ({
  page,
}) => {
  profiles.get(1)!.includeDifferentBrands = true;
  await page.goto("/settings");
  const sizes = page.getByRole("checkbox", {
    name: "Show different package sizes",
    exact: true,
  });
  await expect(sizes).toBeChecked();
  await sizes.uncheck();
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByText(/My Stores saved/)).toBeVisible();
  expect(profiles.get(1)!).toMatchObject({
    includeDifferentPackSizes: false,
    includeDifferentBrands: true,
    compareOnlyPreferredShops: false,
    shops: [],
  });
  await page.reload();
  await expect(sizes).not.toBeChecked();
  await sizes.check();
  await page
    .getByRole("button", { name: "Save My Stores", exact: true })
    .click();
  await expect(page.getByText(/My Stores saved/)).toBeVisible();
  expect(profiles.get(1)!.includeDifferentBrands).toBe(true);
  expect(profiles.get(1)!.includeDifferentPackSizes).toBe(true);
});
