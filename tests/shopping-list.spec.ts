import { test, expect, type Page } from "@playwright/test";

for (const paid of [false, true]) {
  test(`list management creates, selects and ${paid ? "archives" : "deletes"} within the tier limit`, async ({
    page,
  }) => {
    const timestamp = "2026-10-05T00:00:00Z";
    let lists = [
      { id: 1, name: "Weekly", createdDate: timestamp, updatedDate: timestamp },
    ];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path.endsWith("auth/me"))
        return route.fulfill({
          json: {
            account: {
              id: 1,
              displayName: "Alex",
              isTrial: false,
              isPaid: paid,
            },
            shoppingListId: 1,
          },
        });
      if (path.endsWith("/manage"))
        return route.fulfill({
          json: { isPaid: paid, limit: paid ? 5 : 2, lists },
        });
      if (path === "/api/shopping-lists" && method === "POST") {
        const created = {
          id: 2,
          name: route.request().postDataJSON().name,
          createdDate: timestamp,
          updatedDate: timestamp,
        };
        lists.push(created);
        return route.fulfill({ json: created });
      }
      if (method === "DELETE" || path.endsWith("/archive")) {
        expect(route.request().postDataJSON().expectedUpdatedDate).toBe(
          timestamp,
        );
        lists = lists.filter((list) => list.id !== 2);
        return route.fulfill({ status: 204 });
      }
      if (path.endsWith("/imports"))
        return route.fulfill({ json: { items: [], nextBeforeId: null } });
      if (path.endsWith("/plan"))
        return route.fulfill({
          json: {
            id: 1,
            name: "Weekly",
            items: [],
            lowest: { subtotal: 0, pricedCount: 0, missingItems: [] },
            retailers: [],
          },
        });
      return route.fulfill({ status: 404 });
    });
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Products", exact: true })).toHaveAttribute("href", "/products/history");
    await page.getByLabel("New list name (optional)").fill("Weekend");
    await page.getByRole("button", { name: "Create new list" }).click();
    await expect(page.getByLabel("Selected list")).toHaveValue("2");
    if (!paid) {
      await expect(
        page.getByRole("button", { name: "Create new list" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Archive list" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "History", exact: true }),
      ).toHaveCount(0);
      page.once("dialog", (dialog) => dialog.accept());
    }
    await page
      .getByRole("button", {
        name: paid ? "Archive list" : "Delete list",
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Selected list")).toHaveValue("1");
    await expect(
      page.getByRole("button", { name: "Create new list" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type {
  Job,
  Session,
  ListItem,
  ListItemUpdate,
  ShoppingListPlan,
  PlanningPrice,
} from "../src/lib/api-types";
import { bestKnownPrices, freshness } from "../src/lib/price-comparison";
import { createShoppingStore } from "../src/stores/shopping-store";

test("root navigation offers in-store shopping before sign in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Shop in store", exact: true }),
  ).toHaveAttribute("href", "/in-store");
});

test("root offers local Chrome extension installation instructions", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "Add Chrome extension", exact: true })
    .click();
  await expect(page).toHaveURL(/\/extension$/);
  await expect(
    page.getByRole("heading", { name: "Install the local test extension" }),
  ).toBeVisible();
  await expect(page.getByText("Load unpacked", { exact: true })).toBeVisible();
});

let server: Server;
let sessions: Map<string, Session>;
let jobs: Map<number, Job>;
let counts: Map<number, number>;
let expire = false;
let offline = false;
let frozen = false;
let failNextSubmit = false;
let calls = 0;
let receivedCookie = "";
let sources = new Map<number, string>();
let comparison: ((job: Job) => Job) | null = null;
let listItems = new Map<number, ListItem>();
let failEdit = false;
let planningPrices = new Map<number, PlanningPrice[]>();
function mockPlan(listId: number): ShoppingListPlan {
  const items = [...listItems.values()]
    .filter((i) => i.shoppingListId === listId)
    .sort((a, b) => b.id - a.id)
    .map((item) => {
      const job = [...jobs.values()].find(
        (j) => j.product?.id === item.product.id && j.shoppingListId === listId,
      );
      const prices: PlanningPrice[] =
        planningPrices.get(item.id) ??
        job?.retailers
          .filter((r) => r.prices.length > 0)
          .map((r) => ({
            shopId: r.shopId,
            shopName: r.shopName,
            price: r.prices[0].price,
            includedInTotal: r.status === "Exact",
            status: r.status === "Exact" ? "Fresh" : "Match not verified",
            productUrl: r.prices[0].sourceUrl,
            checkedDate: r.prices[0].checkedDate,
            specialDescription: r.prices[0].specialDescription,
          })) ??
        [];
      return { item, prices };
    });
  const basket = (shopId: number | null, name: string) => {
    const costs = items.map((row) => ({
      row,
      prices: row.prices.filter(
        (p) =>
          p.includedInTotal &&
          p.price !== null &&
          (shopId === null || p.shopId === shopId),
      ),
    }));
    return {
      shopId,
      name,
      subtotal: costs.reduce(
        (sum, { row, prices }) =>
          sum +
          (prices.length
            ? Math.min(
                ...prices.map((p) =>
                  p.quantityPrice?.quantity === row.item.quantity
                    ? p.quantityPrice.total
                    : p.price! * row.item.quantity,
                ),
              )
            : 0),
        0,
      ),
      pricedCount: costs.filter((c) => c.prices.length).length,
      missingItems: costs
        .filter((c) => !c.prices.length)
        .map((c) => ({
          itemId: c.row.item.id,
          name: c.row.item.product.name,
          reason: "No price available",
        })),
    };
  };
  return {
    id: listId,
    name: "Weekly shop",
    items,
    lowest: basket(null, "Lowest total across shops"),
    retailers: [basket(1, "Coles"), basket(2, "Woolworths")],
  };
}
let accounts = new Map<string, { password: string; session: Session }>();
let failAuth = false;
const sessionExpiry = () => new Date(Date.now() + 3 * 3600000).toISOString();
const product = {
  id: 1,
  name: "Coca-Cola Classic Cans",
  brand: "Coca-Cola",
  variant: "Classic",
  packQuantity: 10,
  packSize: 375,
  packUnit: "mL",
  imageUrl: null,
};
function completed(job: Job): Job {
  const woolworths = sources.get(job.jobId)?.includes("woolworths.com.au");
  return {
    ...job,
    product,
    status: "Partial",
    progressStage: "Completed",
    shoppingListProductId: job.jobId,
    completedDate: new Date().toISOString(),
    retailers: [
      {
        shopId: woolworths ? 2 : 1,
        shopName: woolworths ? "Woolworths" : "Coles",
        status: "Exact",
        matchType: "Exact",
        matchConfidence: 100,
        isFromCache: false,
        checkedDate: job.createdDate,
        errorCode: null,
        prices: [
          {
            price: 23,
            normalPrice: null,
            unitPrice: null,
            currency: "AUD",
            shopLocationId: null,
            priceScope: "Unknown",
            sourceType: "StructuredData",
            sourceUrl:
              sources.get(job.jobId) ?? "https://www.coles.com.au/product/test",
            checkedDate: job.createdDate,
            inStock: true,
            specialType: null,
            specialDescription: null,
            specialStartDate: null,
            specialEndDate: null,
          },
        ],
      },
      {
        shopId: woolworths ? 1 : 2,
        shopName: woolworths ? "Coles" : "Woolworths",
        status: "NotSupported",
        matchType: null,
        matchConfidence: null,
        isFromCache: false,
        checkedDate: null,
        errorCode: "comparison_not_implemented",
        prices: [],
      },
    ],
  };
}
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    calls++;
    response.setHeader("Content-Type", "application/json");
    const send = (status: number, value?: unknown) => {
      response.statusCode = status;
      response.end(value === undefined ? undefined : JSON.stringify(value));
    };
    const path = new URL(request.url!, "http://127.0.0.1:5499");
    if (offline) {
      send(503, { title: "Private upstream failure details" });
      return;
    }
    if (
      ["POST", "PUT", "DELETE"].includes(request.method!) &&
      (request.headers.origin !== "http://127.0.0.1:5499" ||
        request.headers["x-myshoppinglist-request"] !== "1")
    ) {
      send(403);
      return;
    }
    receivedCookie = request.headers.cookie ?? "";
    const raw = /myshoppinglist_session=([a-f0-9]+)/.exec(receivedCookie)?.[1];
    const current = raw && !expire ? sessions.get(raw) : undefined;
    if (
      path.pathname === "/api/auth/register" ||
      path.pathname === "/api/auth/login"
    ) {
      if (failAuth) {
        response.setHeader("Retry-After", "60");
        send(429);
        return;
      }
      let body = "";
      for await (const part of request) body += part;
      const value = JSON.parse(body);
      const email = value.email?.trim().toLowerCase();
      const register = path.pathname.endsWith("register");
      if (register && raw && !current) {
        send(401);
        return;
      }
      if (register && accounts.has(email)) {
        send(409, {
          title: "Registration could not be completed with this email.",
        });
        return;
      }
      if (
        !register &&
        (!accounts.has(email) ||
          accounts.get(email)!.password !== value.password)
      ) {
        send(401);
        return;
      }
      const id = current?.account.id ?? 100 + accounts.size;
      const session: Session = register
        ? {
            account: {
              id,
              displayName: value.displayName,
              isTrial: false,
              expiresDate: null,
            },
            shoppingListId: current?.shoppingListId ?? id,
            sessionExpiresDate: new Date(
              Date.now() + 30 * 86400000,
            ).toISOString(),
          }
        : {
            ...accounts.get(email)!.session,
            sessionExpiresDate: new Date(
              Date.now() + 30 * 86400000,
            ).toISOString(),
          };
      if (register) {
        accounts.set(email, { password: value.password, session });
        for (const [token, old] of sessions)
          if (old.account.id === id) sessions.delete(token);
      }
      const token = randomBytes(32).toString("hex");
      sessions.set(token, session);
      expire = false;
      response.setHeader(
        "Set-Cookie",
        `myshoppinglist_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
      );
      send(register ? 201 : 200, session);
      return;
    }
    if (path.pathname === "/api/auth/trial") {
      if (current) {
        send(200, current);
        return;
      }
      const token = randomBytes(32).toString("hex");
      const id = sessions.size + 1;
      const session: Session = {
        account: {
          id,
          displayName: "Trial shopper",
          isTrial: true,
          expiresDate: sessionExpiry(),
        },
        shoppingListId: id,
        sessionExpiresDate: sessionExpiry(),
      };
      sessions.set(token, session);
      expire = false;
      response.setHeader(
        "Set-Cookie",
        `myshoppinglist_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
      );
      send(201, session);
      return;
    }
    if (!current) {
      send(401, { title: "A valid session is required." });
      return;
    }
    if (path.pathname === "/api/auth/me") {
      send(200, current);
      return;
    }
    if (path.pathname === "/api/auth/logout") {
      sessions.delete(raw!);
      response.setHeader(
        "Set-Cookie",
        "myshoppinglist_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
      );
      send(204);
      return;
    }
    const refreshRoute =
      /^\/api\/shopping-lists\/(\d+)(?:\/items\/(\d+))?\/refresh-prices$/.exec(
        path.pathname,
      );
    if (refreshRoute && request.method === "POST") {
      const item = refreshRoute[2]
        ? listItems.get(Number(refreshRoute[2]))
        : null;
      const allowed =
        Number(refreshRoute[1]) === current.shoppingListId &&
        (!refreshRoute[2] || item?.shoppingListId === current.shoppingListId);
      send(allowed ? 200 : 404, {
        queued: 0,
        alreadyRunning: 0,
        current: 1,
        deferred: 0,
      });
      return;
    }
    const planRoute = /^\/api\/shopping-lists\/(\d+)\/plan$/.exec(
      path.pathname,
    );
    if (planRoute) {
      send(
        Number(planRoute[1]) === current.shoppingListId ? 200 : 404,
        mockPlan(Number(planRoute[1])),
      );
      return;
    }
    const listRoute = /^\/api\/shopping-lists\/(\d+)\/items(?:\/(\d+))?$/.exec(
      path.pathname,
    );
    if (listRoute) {
      if (Number(listRoute[1]) !== current.shoppingListId) {
        send(404);
        return;
      }
      if (request.method === "DELETE" && listRoute[2]) {
        if (failEdit) {
          send(503);
          return;
        }
        const item = listItems.get(Number(listRoute[2]));
        if (!item || item.shoppingListId !== current.shoppingListId) {
          send(404);
          return;
        }
        let body = "";
        for await (const part of request) body += part;
        if (JSON.parse(body).expectedUpdatedDate !== item.updatedDate) {
          send(409, {
            title: "This item changed. Refresh your list before deleting it.",
          });
          return;
        }
        listItems.delete(item.id);
        for (const [id, job] of jobs)
          if (job.shoppingListProductId === item.id)
            jobs.set(id, { ...job, shoppingListProductId: null });
        send(204);
        return;
      }
      if (request.method === "GET" && !listRoute[2]) {
        const before = Number(path.searchParams.get("beforeId")) || Infinity;
        const all = [...listItems.values()]
          .filter(
            (i) =>
              i.shoppingListId === current.shoppingListId &&
              i.id < before &&
              (path.searchParams.get("includeHidden") === "true" ||
                !i.isHidden) &&
              (path.searchParams.get("includePurchased") !== "false" ||
                !i.isPurchased),
          )
          .sort((a, b) => b.id - a.id);
        const items = all.slice(0, 20);
        send(200, {
          items,
          nextBeforeId: all.length > 20 ? items.at(-1)!.id : null,
        });
        return;
      }
      if (request.method === "PUT" && listRoute[2]) {
        if (failEdit) {
          send(503, { title: "Unavailable" });
          return;
        }
        const item = listItems.get(Number(listRoute[2]));
        if (!item || item.shoppingListId !== current.shoppingListId) {
          send(404);
          return;
        }
        let body = "";
        for await (const part of request) body += part;
        const edit = JSON.parse(body) as ListItemUpdate;
        if (edit.expectedUpdatedDate !== item.updatedDate) {
          send(409, {
            title: "This item changed. Reload it before saving your edits.",
          });
          return;
        }
        if (
          !Number.isInteger(edit.quantity) ||
          edit.quantity < 1 ||
          (edit.notes?.length ?? 0) > 4000
        ) {
          send(400, { title: "Invalid edit" });
          return;
        }
        const saved = {
          ...item,
          quantity: edit.quantity,
          notes: edit.notes,
          isPurchased: edit.isPurchased,
          isHidden: edit.isHidden,
          purchasedDate: edit.isPurchased
            ? (item.purchasedDate ?? new Date().toISOString())
            : null,
          updatedDate: new Date(
            Math.max(Date.now(), Date.parse(item.updatedDate) + 1),
          ).toISOString(),
        };
        listItems.set(item.id, saved);
        send(200, saved);
        return;
      }
      send(404);
      return;
    }
    if (path.pathname.endsWith("/products/url")) {
      if (failNextSubmit) {
        failNextSubmit = false;
        response.setHeader("Retry-After", "60");
        send(429, { title: "Too many requests" });
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      const value = JSON.parse(body);
      if (value.url.startsWith("https://www.aldi.com.au/")) {
        send(400, {
          title:
            "Add ALDI products from an open product page using the extension. Automatic ALDI searches and price refreshes are unavailable.",
          errorCode: "source_restricted",
        });
        return;
      }
      if (
        !value.url.startsWith("https://www.coles.com.au/product/") &&
        !value.url.startsWith(
          "https://www.woolworths.com.au/shop/productdetails/",
        )
      ) {
        send(400, { title: "Enter a valid Coles or Woolworths product URL." });
        return;
      }
      const id = jobs.size + 1;
      sources.set(id, value.url);
      const created = new Date().toISOString();
      jobs.set(id, {
        jobId: id,
        shoppingListId: current.shoppingListId!,
        quantity: value.quantity,
        status: "Queued",
        progressStage: "Queued",
        product: null,
        shoppingListProductId: null,
        createdDate: created,
        lastActivityDate: created,
        completedDate: null,
        nextAttemptDate: null,
        errorCode: null,
        retailers: [],
      });
      response.setHeader("Location", `/api/product-import-jobs/${id}`);
      send(202, {
        jobId: id,
        status: "Queued",
        quantity: value.quantity,
        reused: false,
        statusUrl: `/api/product-import-jobs/${id}`,
      });
      return;
    }
    if (path.pathname.endsWith("/imports")) {
      const before = Number(path.searchParams.get("beforeId")) || Infinity;
      const entries = [...jobs.values()]
        .filter(
          (j) =>
            j.shoppingListId === current.shoppingListId && j.jobId < before,
        )
        .sort((a, b) => b.jobId - a.jobId);
      const items = entries.slice(0, 20).map((j) => ({
        jobId: j.jobId,
        status: j.status,
        createdDate: j.createdDate,
      }));
      send(200, {
        items,
        nextBeforeId: entries.length > 20 ? items.at(-1)!.jobId : null,
      });
      return;
    }
    const id = Number(path.pathname.split("/").at(-1));
    const job = jobs.get(id);
    if (!job || job.shoppingListId !== current.shoppingListId) {
      send(404);
      return;
    }
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    const next =
      frozen || count < 2
        ? {
            ...job,
            status: "Processing" as const,
            progressStage: "ReadingSourceProduct",
          }
        : comparison
          ? comparison(completed(job))
          : completed(job);
    if (next.product) {
      let item = [...listItems.values()].find(
        (i) =>
          i.product.id === next.product!.id &&
          i.shoppingListId === next.shoppingListId,
      );
      if (!item) {
        item = {
          id: listItems.size + 1,
          shoppingListId: next.shoppingListId,
          product: next.product,
          quantity: next.quantity,
          notes: null,
          isPurchased: false,
          isHidden: false,
          purchasedDate: null,
          preferredShopId: null,
          addedDate: next.createdDate,
          updatedDate: next.createdDate,
        };
        listItems.set(item.id, item);
      }
      next.shoppingListProductId = item.id;
    }
    jobs.set(id, next);
    send(200, next);
  });
  await new Promise<void>((resolve) =>
    server.listen(5499, "127.0.0.1", resolve),
  );
});
test.beforeEach(() => {
  accounts = new Map();
  failAuth = false;
  sessions = new Map();
  jobs = new Map();
  sources = new Map();
  counts = new Map();
  expire = false;
  offline = false;
  frozen = false;
  failNextSubmit = false;
  calls = 0;
  receivedCookie = "";
  comparison = null;
  listItems = new Map();
  planningPrices = new Map();
  failEdit = false;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start my shopping list" }).click();
  await expect(page.getByText("Your trial is active")).toBeVisible();
}
const accountPassword = "Abcdef1!";
test("shopping stores isolate sessions and clear account data while preserving same-list conversion", () => {
  const first = createShoppingStore();
  const second = createShoppingStore();
  const trial: Session = {
    account: {
      id: 1,
      displayName: "Trial",
      isTrial: true,
      expiresDate: sessionExpiry(),
    },
    shoppingListId: 1,
    sessionExpiresDate: sessionExpiry(),
  };
  first.getState().actions.setSession(trial);
  const item: ListItem = {
    id: 1,
    shoppingListId: 1,
    product,
    quantity: 2,
    notes: "Saved",
    isPurchased: false,
    isHidden: false,
    purchasedDate: null,
    preferredShopId: null,
    addedDate: new Date().toISOString(),
    updatedDate: new Date().toISOString(),
  };
  first.getState().actions.setItems([item]);
  first.getState().actions.setErrors({ 1: "Paused" });
  expect(second.getState().session).toBeNull();
  expect(second.getState().items).toEqual([]);
  first.getState().actions.setSession({
    ...trial,
    account: { ...trial.account, isTrial: false, expiresDate: null },
  });
  expect(first.getState().items).toEqual([item]);
  first.getState().actions.setSession({
    ...trial,
    account: { ...trial.account, id: 2 },
    shoppingListId: 2,
  });
  expect(first.getState().items).toEqual([]);
  expect(first.getState().errors).toEqual({});
  first.getState().actions.setItems([{ ...item, shoppingListId: 2 }]);
  first.getState().actions.clearSession();
  expect(first.getState().session).toBeNull();
  expect(first.getState().items).toEqual([]);
});

test("stalled session restoration times out and retries without losing the session", async ({
  page,
}) => {
  await start(page);
  await page.clock.install();
  let stall = true;
  await page.route("**/api/auth/me", (route) => {
    if (!stall) return route.continue();
  });
  const requested = page.waitForRequest("**/api/auth/me");
  await page.reload();
  await requested;
  await expect(page.getByText("Restoring your shopping list…")).toBeVisible();
  await page.clock.fastForward(21000);
  await expect(
    page.getByRole("alert").filter({ hasText: "took too long" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start my shopping list", exact: true }),
  ).toBeHidden();
  stall = false;
  await page.getByRole("button", { name: "Retry restoring my list" }).click();
  await expect(page.getByText("Your trial is active")).toBeVisible();
  await expect(page.getByRole("link", { name: "Extension setup and instructions" })).toBeVisible();
  expect(sessions.size).toBe(1);
});

async function fillAccount(page: Page, register = true) {
  if (register) await page.getByLabel("Display name").fill("Test shopper");
  await page.getByLabel("Email", { exact: true }).fill("shopper@example.test");
  await page.getByLabel("Password", { exact: true }).fill(accountPassword);
}

test("account registration validates every password requirement before sending", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await fillAccount(page);
  const password = page.getByLabel("Password", { exact: true });
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/auth/register")) requests++;
  });
  for (const invalid of [
    "Aa1!abc",
    "Abcdefg!",
    "ABCDEFG1!",
    "abcdefg1!",
    "Abcdefg1",
    "Abcdef1 ",
    "Abcdef1\u200B",
  ]) {
    await password.fill(invalid);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    if (invalid.length < 8)
      expect(
        await password.evaluate((e: HTMLInputElement) => e.validity.tooShort),
      ).toBe(true);
    else
      await expect(
        page.getByRole("alert").filter({ hasText: "special character" }),
      ).toBeVisible();
    expect(requests).toBe(0);
  }
  await password.fill(accountPassword);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Signed in as Test shopper", exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
});

test("account registration, login failures, rate limits and refresh recovery", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await fillAccount(page);
  await page.screenshot({
    path: `test-results/${info.project.name}-registration.png`,
    fullPage: true,
  });
  failAuth = true;
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "60 seconds" }),
  ).toBeVisible();
  failAuth = false;
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Signed in as Test shopper", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "myshoppinglist_session",
  );
  await page.reload();
  await expect(
    page.getByRole("group", { name: "Signed in as Test shopper", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await fillAccount(page, false);
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Sign in to my account" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "The email or password is incorrect." }),
  ).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(accountPassword);
  await page.getByRole("button", { name: "Sign in to my account" }).click();
  await expect(
    page.getByRole("group", { name: "Signed in as Test shopper", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("account trial conversion preserves saved edits and unsaved drafts", async ({
  page,
}, info) => {
  await start(page);
  await add(page);
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByLabel("Notes", { exact: true })).toBeVisible();
  await page.getByLabel("Notes", { exact: true }).fill("Saved note");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect.poll(() => [...listItems.values()][0]?.notes).toBe("Saved note");
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await page.getByLabel("Notes", { exact: true }).fill("Unsaved draft");
  const old = [...sessions.values()][0];
  await page.getByRole("button", { name: "Keep my list", exact: true }).click();
  await fillAccount(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Signed in as Test shopper", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
    "Unsaved draft",
  );
  expect(accounts.get("shopper@example.test")!.session.shoppingListId).toBe(
    old.shoppingListId,
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-registered-list.png`,
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
    "Saved note",
  );
});

test("account login replaces trial view without merging trial items", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await fillAccount(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Signed in as Test shopper", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await start(page);
  await add(page);
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByLabel("Notes", { exact: true })).toBeVisible();
  const trialItem = [...listItems.values()][0];
  let releaseRead!: () => void;
  const pendingRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let readReady!: () => void;
  const capturedRead = new Promise<void>((resolve) => {
    readReady = resolve;
  });
  await page.route(
    `**/shopping-lists/${trialItem.shoppingListId}/plan`,
    async (route) => {
      const response = await route.fetch();
      readReady();
      await pendingRead;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  await page
    .getByRole("button", { name: "Refresh items", exact: true })
    .click();
  await capturedRead;
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText(/This trial list will not be merged/),
  ).toBeVisible();
  await fillAccount(page, false);
  await page.getByRole("button", { name: "Sign in to my account" }).click();
  await expect(
    page.getByRole("group", { name: "Signed in as Test shopper", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Notes", { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByRole("article"),
  ).toHaveCount(0);
  releaseRead();
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByLabel("Notes", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      "Products you save with the Chrome extension will appear here. Use Refresh items after saving.",
    ),
  ).toBeVisible();
  expect(listItems.get(trialItem.id)!.shoppingListId).toBe(
    trialItem.shoppingListId,
  );
});

test("account expired trial requires explicit reset before fresh registration", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Keep my list", exact: true }).click();
  await fillAccount(page);
  expire = true;
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Clear expired session for a new account",
    }),
  ).toBeVisible();
  expect(accounts.size).toBe(0);
  await page
    .getByRole("button", { name: "Clear expired session for a new account" })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "empty list" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Signed in as Test shopper", exact: true }),
  ).toBeVisible();
  expect(accounts.size).toBe(1);
});

test("account session survives timer maximum and expires at its actual deadline", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await fillAccount(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Signed in as Test shopper", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(2147483647);
  await expect(
    page.getByRole("group", { name: "Signed in as Test shopper", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(7 * 86400000);
  await expect(
    page.getByText(
      "Your session has ended. Sign in again or start a new trial.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
});

test("account gateway enforces JSON, sizes, methods and safe expired reset", async ({
  page,
}) => {
  await start(page);
  const results = await page.evaluate(async () => {
    const send = async (
      path: string,
      method: string,
      body?: string,
      headers: Record<string, string> = {},
    ) => (await fetch("/api/auth/" + path, { method, body, headers })).status;
    const headers = {
      "Content-Type": "application/json",
      "X-MyShoppingList-Request": "1",
    };
    return [
      await send("register", "POST", "{}"),
      await send("login", "PUT", "{}", headers),
      await send("register", "POST", "{}", { "X-MyShoppingList-Request": "1" }),
      await send("register", "POST", "{", headers),
      await send(
        "login",
        "POST",
        JSON.stringify({ password: "a".repeat(17000) }),
        headers,
      ),
      await send("reset-expired", "POST", undefined, headers),
      await send("reset-expired", "GET"),
    ];
  });
  expect(results).toEqual([403, 404, 415, 400, 413, 409, 404]);
  await page.reload();
  await expect(page.getByText("Your trial is active")).toBeVisible();
});
async function add(page: Page, code = "test") {
  // Simulate a product already saved by the extension, without a collection request.
  const cookie = (await page.context().cookies()).find(c => c.name === "myshoppinglist_session")!;
  const session = sessions.get(cookie.value)!;
  const id = jobs.size + 1;
  const createdDate = new Date().toISOString();
  sources.set(id, "https://www.coles.com.au/product/" + code);
  let saved = completed({
    jobId: id, shoppingListId: session.shoppingListId!, quantity: 1,
    status: "Completed", progressStage: "Completed", product: null, shoppingListProductId: null,
    createdDate, lastActivityDate: createdDate, completedDate: createdDate,
    nextAttemptDate: null, errorCode: null, retailers: [],
  });
  if (comparison) saved = comparison(saved);
  jobs.set(id, saved);
  listItems.set(id, {
    id, shoppingListId: saved.shoppingListId, product: saved.product!, quantity: saved.quantity,
    notes: null, isPurchased: false, isHidden: false, purchasedDate: null,
    preferredShopId: null, addedDate: createdDate, updatedDate: createdDate,
  });
  await page.getByRole("button", { name: "Refresh items", exact: true }).click();
  await expect(page.getByRole("region", { name: "Editable shopping list" }).getByRole("article")).toBeVisible();
}

test("gateway rejects unknown routes and cross-origin posts without contacting upstream", async ({
  request,
}) => {
  const before = calls;
  expect((await request.get("/api/admin/secrets")).status()).toBe(404);
  expect((await request.post("/api/auth/trial")).status()).toBe(403);
  expect(
    (
      await request.post("/api/auth/trial", {
        headers: {
          "X-MyShoppingList-Request": "1",
          Origin: "https://evil.example",
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/shopping-lists/1/products/url", {
        headers: {
          "X-MyShoppingList-Request": "1",
          "Content-Type": "application/json",
        },
        data: "x".repeat(5000),
      })
    ).status(),
  ).toBe(413);
  expect(calls).toBe(before);
  await request.post("/api/auth/trial", {
    headers: { "X-MyShoppingList-Request": "1" },
  });
  await request.get("/api/auth/me", {
    headers: { Cookie: "handytool_session=secret; tracking=private" },
  });
  expect(receivedCookie).not.toContain("secret");
  expect(receivedCookie).not.toContain("tracking");
});

function comparable(job: Job): Job {
  const source = job.retailers[0];
  const price = { ...source.prices[0], priceScope: "National" };
  return {
    ...job,
    retailers: [
      { ...source, prices: [price] },
      {
        ...source,
        shopId: 2,
        shopName: "Woolworths",
        isFromCache: true,
        prices: [
          {
            ...price,
            price: 19,
            sourceUrl: "https://www.woolworths.com.au/shop/productdetails/test",
          },
        ],
      },
    ],
  };
}

test("multibuy deal updates quantity totals and retailer ranking", async ({
  page,
}, info) => {
  await start(page);
  await add(page);
  const list = page.getByRole("region", { name: "Editable shopping list" });
  const card = list.getByRole("article");
  await expect(card).toBeVisible({ timeout: 10000 });
  planningPrices.set(1, [
    {
      shopId: 1,
      shopName: "Coles",
      price: 30,
      includedInTotal: true,
      status: "Fresh",
      productUrl: "https://www.coles.com.au/product/1115507",
      checkedDate: new Date().toISOString(),
      specialDescription: "Pick any 2 for $30",
      multibuy: { quantity: 2, total: 30, unitPrice: 15, savings: 30 },
      quantityPrice: {
        quantity: 1,
        total: 30,
        ordinaryTotal: 30,
        savings: 0,
        appliedBundles: 0,
        remainingQuantity: 1,
      },
    },
  ]);
  await page.reload();
  const deal = card.getByRole("complementary", {
    name: "Coles multibuy offer",
  });
  await expect(
    deal.getByText("Buy 2 for $30.00", { exact: true }),
  ).toBeVisible();
  await expect(
    deal.getByText("$15.00 each when buying 2", { exact: true }),
  ).toBeVisible();
  await expect(
    deal.getByText("Save $30.00 compared with buying 2 individually.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    deal.getByText(/Buy 2 of this product to qualify/),
  ).toBeVisible();
  await expect(card.getByText("at Coles", { exact: true })).toBeVisible();
  const summary = list.getByRole("region", { name: "Shopping cost summary" });
  await expect(summary.getByText("$30.00", { exact: true })).toHaveCount(2);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/${info.project.name}-multibuy.png`,
  });
  for (const [quantity, total, bundles, remaining] of [
    [2, 30, 1, 0],
    [3, 60, 1, 1],
    [4, 60, 2, 0],
  ]) {
    planningPrices.get(1)![0].quantityPrice = {
      quantity,
      total,
      ordinaryTotal: 30 * quantity,
      savings: 30 * quantity - total,
      appliedBundles: bundles,
      remainingQuantity: remaining,
    };
    await card.getByRole("button", { name: "Increase quantity" }).click();
    await expect(
      summary.getByText(`$${total.toFixed(2)}`, { exact: true }),
    ).toHaveCount(2);
    await expect(deal).toContainText(`Deal applied ${bundles} time(s)`);
    if (remaining)
      await expect(deal).toContainText("1 remaining at the single-item price");
  }
  planningPrices.get(1)!.push({
    shopId: 2,
    shopName: "Woolworths",
    price: 20,
    includedInTotal: true,
    status: "Fresh",
    productUrl: null,
    checkedDate: null,
    specialDescription: null,
  });
  await page.reload();
  await expect(card.getByText("at Coles", { exact: true })).toBeVisible();
  await expect(card).toContainText("$80.00 total");
  await expect(
    deal.getByText("Buy 2 for $30.00", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("planning cards show prices, save quantities and notes, and delete only the list entry", async ({
  page,
}, info) => {
  comparison = comparable;
  await start(page);
  await add(page);
  const list = page.getByRole("region", { name: "Editable shopping list" });
  const card = list.getByRole("article");
  await expect(card).toBeVisible({ timeout: 10000 });
  await expect(card.getByText("at Woolworths", { exact: true })).toBeVisible();
  await expect(card.getByText(/Coles:.*23.00 total/)).toBeVisible();
  await expect(list.getByLabel("Purchased", { exact: true })).toHaveCount(0);
  await expect(list.getByLabel("Hidden", { exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "Increase quantity" }).click();
  await expect(card.getByLabel("Item quantity")).toHaveText("2");
  await expect(
    list
      .getByRole("region", { name: "Shopping cost summary" })
      .getByText("$38.00", { exact: true }),
  ).toHaveCount(2);
  await card.getByRole("button", { name: "Add note" }).click();
  await card.getByLabel("Notes").fill("Two for the pantry");
  await card.getByRole("button", { name: "Save note" }).click();
  await expect(
    card.getByText("Two for the pantry", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(card.getByLabel("Item quantity")).toHaveText("2");
  await expect(
    card.getByText("Two for the pantry", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-planning.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await card.getByRole("button", { name: "Keep item" }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await card.getByRole("button", { name: "Delete item" }).click();
  await expect(card).toHaveCount(0);
  expect(listItems.size).toBe(0);
  expect(jobs.size).toBe(1);
});

test("failed saves and conflicts preserve note drafts until explicit reload", async ({
  page,
}) => {
  await start(page);
  await add(page);
  const card = page
    .getByRole("region", { name: "Editable shopping list" })
    .getByRole("article");
  await card.getByRole("button", { name: "Add note" }).click();
  await card.getByLabel("Notes").fill("Unsaved draft");
  failEdit = true;
  await card.getByRole("button", { name: "Save note" }).click();
  await expect(card.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await expect(card.getByLabel("Notes")).toHaveValue("Unsaved draft");
  failEdit = false;
  const original = listItems.get(1)!;
  listItems.set(1, {
    ...original,
    notes: "Changed elsewhere",
    updatedDate: new Date(Date.parse(original.updatedDate) + 1).toISOString(),
  });
  await card.getByRole("button", { name: "Save note" }).click();
  await expect(card.getByRole("alert")).toContainText("This item changed");
  await expect(card.getByLabel("Notes")).toHaveValue("Unsaved draft");
  await expect(card.getByRole("button", { name: "Save note" })).toBeDisabled();
  await card.getByRole("button", { name: "Load latest saved version" }).click();
  await expect(card.getByLabel("Notes")).toHaveValue("Changed elsewhere");
  await card.getByLabel("Notes").fill("");
  await card.getByRole("button", { name: "Save note" }).click();
  await expect(card.getByText("Note saved.")).toBeVisible();
  expect(listItems.get(1)!.notes).toBeNull();
});

test("planning includes the whole list, highlights missing prices and preserves drafts during refresh", async ({
  page,
}) => {
  await start(page);
  await add(page);
  const list = page.getByRole("region", { name: "Editable shopping list" });
  await expect(list.getByRole("article")).toBeVisible({ timeout: 10000 });
  const original = listItems.get(1)!;
  for (let id = 2; id <= 22; id++)
    listItems.set(id, {
      ...original,
      id,
      isPurchased: true,
      isHidden: true,
      product: { ...product, id, name: `Extra product ${id}` },
    });
  await page.reload();
  await expect(list.getByRole("article")).toHaveCount(22);
  const summary = list.getByRole("region", { name: "Shopping cost summary" });
  await expect(
    summary.getByText("1 of 22 items priced · includes quantities"),
  ).toHaveCount(2);
  await expect(
    summary.getByText("0 of 22 items priced · includes quantities"),
  ).toBeVisible();
  await expect(
    summary.getByRole("heading", { name: "Only Woolworths" }).locator(".."),
  ).toHaveClass(/bg-red-50/);
  await summary
    .locator("summary")
    .filter({ hasText: "22 items missing prices" })
    .click();
  await expect(
    summary.getByRole("link", { name: "Extra product 22" }),
  ).toBeVisible();
  const card = list.getByRole("article", { name: product.name, exact: true });
  await card.getByRole("button", { name: "Add note" }).click();
  await card.getByLabel("Notes").fill("Keep my draft");
  await list.getByRole("button", { name: "Refresh items" }).click();
  await expect(list.getByText("Loading list items…")).toHaveCount(0);
  await expect(card.getByLabel("Notes")).toHaveValue("Keep my draft");

  expire = true;
  await card.getByRole("button", { name: "Save note" }).click();
  await expect(
    page.getByText("Your trial has ended. Start a new trial to continue."),
  ).toBeVisible();
  await expect(list).toHaveCount(0);
});

test("editing gateway allows full-length notes and rejects unsafe delete and edit requests", async ({
  page,
  request,
}) => {
  await start(page);
  await add(page);
  const card = page
    .getByRole("region", { name: "Editable shopping list" })
    .getByRole("article");
  await card.getByRole("button", { name: "Add note" }).click();
  const notes = "購".repeat(4000);
  await card.getByLabel("Notes").fill(notes);
  await card.getByRole("button", { name: "Save note" }).click();
  await expect(card.getByText("Note saved.")).toBeVisible();
  expect(listItems.get(1)!.notes).toBe(notes);
  const before = calls;
  expect(
    (await request.put("/api/shopping-lists/1/items/1", { data: {} })).status(),
  ).toBe(403);
  expect(
    (
      await request.delete("/api/shopping-lists/1/items/1", { data: {} })
    ).status(),
  ).toBe(403);
  const headers = {
    "X-MyShoppingList-Request": "1",
    "Content-Type": "application/json",
  };
  expect(
    (
      await request.delete("/api/shopping-lists/1/items/1", {
        headers: { ...headers, Origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.delete("/api/shopping-lists/1/plan", { headers, data: {} })
    ).status(),
  ).toBe(404);
  expect(
    (await request.put("/api/auth/trial", { headers, data: {} })).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/shopping-lists/1/items/1", { headers, data: {} })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.put("/api/shopping-lists/1/items/1", {
        headers,
        data: "a".repeat(32769),
      })
    ).status(),
  ).toBe(413);
  expect(
    (
      await request.get("/api/shopping-lists/1/items?includeHidden=invalid")
    ).status(),
  ).toBe(400);
  expect(calls).toBe(before);
});

for (const [code, explanation] of [
  ["retailer_access_restricted", "The retailer blocked this check."],
  ["read_timeout", "The retailer took too long to respond."],
  ["search_read_failed", "We couldn’t finish this retailer’s check."],
]) {
}

test("comparison rules preserve freshness boundaries, ties and separate price coverage", () => {
  const now = Date.parse("2026-09-20T00:00:00Z");
  const checked = (hours: number) =>
    new Date(now - hours * 3600000).toISOString();
  expect(freshness(checked(6), now)).toBe("Fresh");
  expect(freshness(new Date(now - 6 * 3600000 - 1).toISOString(), now)).toBe(
    "Refresh recommended",
  );
  expect(freshness(checked(24), now)).toBe("Refresh recommended");
  expect(freshness(checked(25), now)).toBe("Price may be stale");
  expect(freshness("invalid", now)).toBe("Check time unverified");
  expect(freshness(checked(-1), now)).toBe("Check time unverified");
  const base = completed({ jobId: 1, createdDate: checked(1) } as Job);
  const retailers = comparable(base).retailers;
  retailers[0].prices[0].price = 19;
  expect(bestKnownPrices(retailers, now)[0].shopNames).toEqual([
    "Coles",
    "Woolworths",
  ]);
  const original = structuredClone(retailers[1]);
  const changes = [
    { priceScope: "Unknown" },
    { priceScope: "Online" },
    { priceScope: "StoreSpecific", shopLocationId: 1 },
    { currency: "USD" },
    { inStock: false },
    { checkedDate: checked(7) },
    { price: -1 },
    { specialEndDate: checked(1) },
    { specialStartDate: checked(-1) },
    { specialEndDate: "invalid" },
    { specialDescription: "Members only" },
    { checkedDate: "invalid" },
    { checkedDate: checked(-1) },
  ];
  for (const change of changes) {
    retailers[1] = {
      ...original,
      prices: [{ ...original.prices[0], ...change }],
    };
    expect(bestKnownPrices(retailers, now), JSON.stringify(change)).toEqual([]);
  }
  for (const status of [
    "Likely",
    "Possible",
    "Unavailable",
    "Pending",
    "CheckFailed",
  ] as const) {
    retailers[1] = { ...original, status };
    expect(bestKnownPrices(retailers, now)).toEqual([]);
  }
  retailers[1] = { ...original, shopId: retailers[0].shopId };
  expect(bestKnownPrices(retailers, now)).toEqual([]);
  retailers[1] = original;
  for (const retailer of retailers)
    retailer.prices.push({
      ...retailer.prices[0],
      priceScope: "Online",
      price: 17,
    });
  expect(bestKnownPrices(retailers, now).map((group) => group.scope)).toEqual([
    "National",
    "Online",
  ]);
});

import { checkedToday, priceAge, refreshProgress } from "../src/lib/price-age";

test("price dates distinguish local midnight, missing dates, future checks and incomplete coverage", () => {
  const now = new Date(2026, 9, 17, 0, 1).getTime();
  const yesterday = new Date(2026, 9, 16, 23, 59).toISOString();
  const today = new Date(2026, 9, 17, 0, 0).toISOString();
  expect(checkedToday(yesterday, now)).toBe(false);
  expect(checkedToday(today, now)).toBe(true);
  expect(priceAge(today, true, now)).toBe("Observed today");
  expect(priceAge(yesterday, true, now)).toContain("16 Oct 2026");
  expect(priceAge(today, false, now)).not.toBe("Observed today");
  expect(priceAge(null, true, now)).toContain("unavailable");
  expect(priceAge(new Date(now + 1).toISOString(), true, now)).toContain(
    "unverified",
  );
  const rows = [
    {
      item: { isPurchased: false, isHidden: false },
      prices: [{ checkedDate: today, price: 2, status: "Fresh" }],
    },
  ];
  expect(refreshProgress(rows, [1], now)).toBe("All prices up to date");
  expect(refreshProgress(rows, [1, 2], now)).toContain("matches are missing");
});

test("product refresh passes through the proxy with browser protection and item ownership", async ({
  page,
}) => {
  comparison = comparable;
  await start(page);
  await add(page);
  await expect(
    page
      .getByRole("region", { name: "Editable shopping list" })
      .getByRole("article"),
  ).toBeVisible();
  const item = listItems.get(1)!;
  const path = `/api/shopping-lists/${item.shoppingListId}/items/${item.id}/refresh-prices`;
  expect((await page.request.post(path, { data: {} })).status()).toBe(403);
  const headers = {
    "X-MyShoppingList-Request": "1",
    "X-Client-Timezone": "Australia/Adelaide",
  };
  const response = await page.request.post(path, { headers, data: {} });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ queued: 0, current: 1 });
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(
    (
      await page.request.post(path, {
        headers: { ...headers, Origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(
        `/api/shopping-lists/${item.shoppingListId}/items/99999/refresh-prices`,
        { headers, data: {} },
      )
    ).status(),
  ).toBe(404);
});

test("alternative brands show honest price differences and leave the shopping list unchanged", async ({
  page,
}, info) => {
  let mode = "fresh";
  await page.route("**/api/shopping-lists/*/plan", async (route) => {
    const response = await route.fetch();
    const plan = await response.json();
    for (const row of plan.items) {
      const date = new Date().toISOString();
      row.brandAlternatives =
        mode === "empty"
          ? []
          : [
              {
                relationship: "EquivalentDifferentBrand",
                label: "Similar product — different brand",
                product: {
                  ...row.item.product,
                  id: 999,
                  name: "Other brand coffee 1kg",
                  brand: "Other brand",
                  packSize: 1,
                  packUnit: "kg",
                },
                totalQuantity: 1000,
                unit: "g",
                quantityRatio: 2,
                offer: {
                  shopId: 2,
                  shopName: "Woolworths",
                  price: mode === "missing" ? null : 13,
                  unitPrice: mode === "missing" ? null : 1.3,
                  status:
                    mode === "stale"
                      ? "Stale price"
                      : mode === "missing"
                        ? "No price"
                        : "Fresh",
                  checkedDate: mode === "stale" ? "2026-01-01T00:00:00Z" : date,
                  productUrl:
                    mode === "unsafe"
                      ? "https://www.woolworths.com.au.evil.test/product"
                      : "https://www.woolworths.com.au/shop/productdetails/123456",
                },
                original: {
                  shopId: 1,
                  shopName: "Coles",
                  price: 10,
                  unitPrice: 2,
                  status: "Fresh",
                  checkedDate: date,
                  productUrl: null,
                },
                unitPriceDifferencePercent: -35,
                packagePriceDifference: 3,
              },
            ];
    }
    await route.fulfill({ json: plan });
  });
  await start(page);
  await add(page);
  const section = page.getByRole("region", {
    name: "Alternative brands",
    exact: true,
  });
  await expect(section).toBeVisible();
  await expect(section).toContainText("Similar product — different brand");
  await expect(section).toContainText(
    "35% less per 100 g; costs $3.00 more per package.",
  );
  await expect(section).toContainText(
    "Taste, ingredients and quality may differ",
  );
  await expect(
    section.getByText("Observed today", { exact: true }),
  ).toHaveCount(2);
  const baseline = [...listItems.values()].map((item) => structuredClone(item));
  const summary = page.getByRole("region", { name: "Shopping cost summary" });
  const totalBefore = await summary.innerText();
  const link = section.getByRole("link", {
    name: "Check this alternative at Woolworths",
    exact: true,
  });
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute(
    "href",
    "https://www.woolworths.com.au/shop/productdetails/123456",
  );
  await link.focus();
  await expect(link).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await section.screenshot({
    path: `test-results/${info.project.name}-brand-planning.png`,
  });
  for (mode of ["stale", "missing", "unsafe", "empty"]) {
    await page.reload();
    if (mode === "empty") await expect(section).toHaveCount(0);
    else {
      await expect(section).toBeVisible();
      if (mode === "stale" || mode === "missing") {
        await expect(section).toContainText(
          "A unit-price difference needs current comparable prices for both products.",
        );
        await expect(section.getByText(/35% less/)).toHaveCount(0);
        await expect(section.getByText(/costs \$3.00/)).toHaveCount(0);
        if (mode === "stale")
          await expect(section).toContainText("Stale price");
        else await expect(section).toContainText("Price unavailable");
      } else
        await expect(
          section.getByRole("link", {
            name: "Check this alternative at Woolworths",
          }),
        ).toHaveCount(0);
    }
    await expect(summary).toHaveText(totalBefore, { useInnerText: true });
    expect([...listItems.values()]).toEqual(baseline);
  }
});

test("extension guidance replaces URL submission and collection activity on desktop and mobile", async ({ page }) => {
  const collection: string[] = [];
  page.on("request", request => {
    if (/products\/url|product-import-jobs|\/imports|refresh-prices|pack-discovery|brand-discovery|retry-comparison/.test(request.url()))
      collection.push(request.method() + " " + request.url());
  });
  await start(page);
  await expect(page.getByRole("heading", { name: "Add products with the Chrome extension" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Extension setup and instructions" })).toHaveAttribute("href", "/extension");
  await expect(page.getByLabel("Product URL")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add product", exact: true })).toHaveCount(0);
  await expect(page.getByText("Import activity", { exact: true })).toHaveCount(0);
  await add(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("region", { name: "Editable shopping list" }).getByRole("article")).toBeVisible();
  expect(collection).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("saved observation reload preserves note drafts without polling or enqueuing collection", async ({ page }) => {
  await start(page); await add(page);
  const card=page.getByRole("region", {name:"Editable shopping list"}).getByRole("article");
  await card.getByRole("button",{name:"Add note"}).click();
  await card.getByLabel("Notes").fill("Keep this draft");
  const saved=mockPlan(listItems.get(1)!.shoppingListId).items[0].prices;
  planningPrices.set(1,saved.map(price=>({...price,price:17,includedInTotal:true,status:"Fresh"})));
  await page.getByRole("button",{name:"Refresh items",exact:true}).click();
  await expect(card).toContainText("$17.00 single-item price");
  await expect(card.getByLabel("Notes")).toHaveValue("Keep this draft");
  await expect(card.getByRole("button",{name:/Refresh price|Retry comparison/})).toHaveCount(0);
  const requests:string[]=[];
  page.on("request",request=>{if(/\/plan|product-import-jobs/.test(request.url())) requests.push(request.url());});
  await page.clock.install();
  await page.clock.fastForward(65000);
  expect(requests).toEqual([]);
});
