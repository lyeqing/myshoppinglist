import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type {
  BrandAlternative,
  ListItem,
  BrandDiscoveryView,
  BrandDiscoveryProgress,
} from "../src/lib/api-types";
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
const alternative = (): BrandAlternative => ({
  relationship: "SuggestedDifferentBrand",
  label: "Suggested alternative — check suitability",
  product: {
    ...item.product,
    id: 2,
    name: "Other Original Coffee 1kg",
    brand: "Other",
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

const initial = (itemId: number | null): BrandDiscoveryView => ({
  accountId: 1,
  listId: 1,
  itemId,
  enabled: true,
  canStart: true,
  reason: null,
  jobs: [],
  queued: 0,
  alreadyRunning: 0,
  recent: 0,
});
async function setup(page: Page) {
  let state = initial(null);
  let discovered = false;
  let posts = 0;
  let error = 0;
  let getError = 0;
  let delayWrite = false;
  let account = 1;
  const requests: string[] = [];
  let release: (() => void) | undefined;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown, status = 200) =>
      route.fulfill({ status, json });
    requests.push(`${route.request().method()} ${path}`);
    if (path.endsWith("/auth/me"))
      return send({
        account: {
          id: account,
          displayName: "Alex",
          isTrial: false,
          isPaid: false,
        },
        shoppingListId: 1,
      });
    if (path.endsWith("/brand-discovery")) {
      const itemId = path.includes("/items/") ? 1 : null;
      if (route.request().method() === "POST") {
        posts++;
        expect(route.request().postDataJSON()).toEqual({
          expectedAccountId: 1,
        });
        if (delayWrite)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        if (account !== 1)
          return send(
            { title: "Your account changed. Reload your list." },
            409,
          );
        if (error)
          return send(
            { title: "Discovery unavailable. Please reload and try again." },
            error,
          );
        state = {
          ...state,
          canStart: false,
          queued: 1,
          jobs: [
            {
              id: 10,
              itemId: 1,
              productName: item.product.name,
              shopName: "Woolworths",
              status: "WaitingForExtension",
              foundCount: 0,
              errorCode: null,
              updatedDate: timestamp,
              retryAfter: null,
            },
          ],
        };
      } else if (getError)
        return send({ title: "Cannot load other-size search" }, getError);
      return send({ ...state, accountId: account, itemId });
    }
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
    const row = {
      item,
      prices: [price],
      brandAlternatives: discovered ? [alternative()] : [],
    };
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
  return {
    autoStart: () => {
      state = { ...state, canStart: false, jobs: [{ id: 10, itemId: 1, productName: item.product.name,
        shopName: "Woolworths", status: "Queued", foundCount: 0, errorCode: null, updatedDate: timestamp, retryAfter: null }] };
    },
    posts: () => posts,
    requests,
    allowStart: () => { state = { ...state, canStart: true }; },
    complete: (
      status: BrandDiscoveryProgress["status"] = "Completed",
      count = 1,
    ) => {
      discovered = count > 0;
      state = {
        ...state,
        queued: 0,
        canStart: false,
        jobs: state.jobs.map((j) => ({
          ...j,
          status,
          foundCount: count,
          updatedDate: new Date().toISOString(),
          retryAfter: status === "Failed" ? "2099-01-01T00:00:00Z" : null,
        })),
      };
    },
    disable: () => {
      state = {
        ...state,
        enabled: false,
        canStart: false,
        reason: "Enable alternative brands in Settings to search.",
        jobs: [],
      };
    },
    fail: (code: number) => {
      error = code;
    },
    failRead: (code: number) => {
      getError = code;
    },
    defer: () => {
      delayWrite = true;
    },
    release: () => release?.(),
    changeAccount: () => {
      account = 2;
      state = initial(null);
    },
  };
}
async function open(page: Page, view: string) {
  await page.goto(view === "planning" ? "/" : "/in-store");
  if (view === "in-store")
    await page.getByRole("button", { name: /Weekly/ }).click();
}

for (const view of ["planning", "in-store"]) {
  test(view + ": saved alternative brands suggestions remain available without discovery requests", async ({ page }) => {
    const fixture = await setup(page);
    fixture.complete();
    const requests: string[] = [];
    page.on("request", request => { if (/pack-discovery|brand-discovery/.test(request.url())) requests.push(request.url()); });
    await open(page, view);
    await expect(page.getByText("Other Original Coffee 1kg", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Find other sizes|Find alternative brands/ })).toHaveCount(0);
    expect(fixture.posts()).toBe(0);
    await page.clock.install();
    await page.clock.fastForward(65000);
    expect(requests).toEqual([]);
    await page.reload();
    if(view === "in-store") await page.getByRole("button", {name:/Weekly/}).click();
    await expect(page.getByText("Other Original Coffee 1kg", {exact:true}).first()).toBeVisible();
    expect(fixture.posts()).toBe(0);
  });
}
let server: Server;
let writes = 0;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (!req.headers.cookie) {
      res.statusCode = 401;
      res.end(JSON.stringify({ title: "Sign in" }));
      return;
    }
    const itemId = req.url?.includes("/items/") ? 1 : null;
    if (req.method === "POST") {
      writes++;
      let raw = "";
      for await (const part of req) raw += part;
      const data = JSON.parse(raw);
      if (data.expectedAccountId !== 1) {
        res.statusCode = 409;
        res.end(JSON.stringify({ title: "Account changed" }));
        return;
      }
    }
    res.end(JSON.stringify(initial(itemId)));
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
test("discovery proxy protects writes, content types, methods and caching", async ({
  page,
}) => {
  writes = 0;
  await page.context().addCookies([
    {
      name: "myshoppinglist_session",
      value: "a".repeat(64),
      url: "http://127.0.0.1:3001",
    },
  ]);
  const path = "/api/shopping-lists/1/items/1/brand-discovery";
  expect(
    (
      await page.request.post(path, { data: { expectedAccountId: 1 } })
    ).status(),
  ).toBe(403);
  const headers = { "X-MyShoppingList-Request": "1" };
  expect(
    (
      await page.request.post(path, {
        headers: { ...headers, "Content-Type": "text/plain" },
        data: "{}",
      })
    ).status(),
  ).toBe(415);
  expect(
    (
      await page.request.post(path, {
        headers: { ...headers, Origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(writes).toBe(0);
  const response = await page.request.post(path, {
    headers,
    data: { expectedAccountId: 1 },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await page.request.get(path)).status()).toBe(200);
  expect((await page.request.put(path, { headers, data: {} })).status()).toBe(
    404,
  );
  expect(writes).toBe(1);
});
