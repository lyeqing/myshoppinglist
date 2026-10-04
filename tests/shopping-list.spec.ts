import { test, expect, type Page } from "@playwright/test";
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
      const prices =
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
            ? Math.min(...prices.map((p) => p.price!)) * row.item.quantity
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
    const refreshRoute = /^\/api\/shopping-lists\/(\d+)\/refresh-prices$/.exec(
      path.pathname,
    );
    if (refreshRoute && request.method === "POST") {
      send(Number(refreshRoute[1]) === current.shoppingListId ? 200 : 404, {
        queued: 0,
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
  await expect(page.getByLabel("Product URL", { exact: true })).toBeEnabled();
  expect(sessions.size).toBe(1);
});

test("stalled import history does not block the list and can be retried", async ({
  page,
}) => {
  await start(page);
  await page.clock.install();
  let stall = true;
  await page.route("**/imports?*", (route) => {
    if (!stall) return route.continue();
  });
  const requested = page.waitForRequest("**/imports?*");
  await page.reload();
  await requested;
  await openActivity(page);
  await expect(page.getByLabel("Product URL", { exact: true })).toBeEnabled();
  await expect(page.getByText("Restoring your shopping list…")).toBeHidden();
  await expect(page.getByText("Loading saved imports…")).toBeVisible();
  await page.clock.fastForward(21000);
  await expect(
    page.getByRole("alert").filter({ hasText: "took too long" }),
  ).toBeVisible();
  stall = false;
  await page
    .getByRole("button", { name: "Retry loading", exact: true })
    .click();
  await expect(page.getByText("Your next shop starts here")).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "took too long" }),
  ).toBeHidden();
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
      "Your saved products will appear here after their details are found.",
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
async function openActivity(page: Page) {
  const summary = page
    .locator("summary")
    .filter({ hasText: "Import activity" });
  await expect(summary).toBeVisible();
  if (!((await summary.locator("..").getAttribute("open")) !== null))
    await summary.click();
}
async function add(page: Page, code = "test") {
  await openActivity(page);
  await page
    .getByLabel("Product URL")
    .fill(`https://www.coles.com.au/product/${code}`);
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/products/url") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await submitted;
  await expect(
    page.getByRole("button", { name: "Add product", exact: true }),
  ).toBeEnabled();
}

test("start, import, price context, terminal polling stop and refresh recovery", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your list. A clearer price." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start my shopping list" }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-welcome.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start my shopping list" }).click();
  await expect(page.getByText("Your trial is active")).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "myshoppinglist_session",
  );
  await add(page);
  await expect(
    page.getByRole("heading", { name: "Finding your product…" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByRole("heading", { name: product.name }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Store not verified")).toBeVisible();
  await expect(
    page.getByText("Comparison not available yet", { exact: true }),
  ).toBeVisible();
  const polled = counts.get(1);
  await page.waitForTimeout(2300);
  expect(counts.get(1)).toBe(polled);
  await page.reload();
  await openActivity(page);
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByRole("heading", { name: product.name }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-list.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Start my shopping list" }),
  ).toBeVisible();
});
test("multiple imports remain usable and all polling stops on expiry", async ({
  page,
}) => {
  frozen = true;
  await start(page);
  await add(page, "one");
  await add(page, "two");
  await expect(
    page.getByText("2 loaded imports · 2 in progress"),
  ).toBeVisible();
  expire = true;
  await expect(
    page.getByText("Your trial has ended. Start a new trial to continue."),
  ).toBeVisible({ timeout: 7000 });
  const count = calls;
  await page.waitForTimeout(2300);
  expect(calls).toBe(count);
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByRole("article"),
  ).toHaveCount(0);
});
test("validation, rate limits and paused updates retain useful state", async ({
  page,
}) => {
  frozen = true;
  await start(page);
  await page.getByLabel("Product URL").fill("https://example.com/product");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "valid Coles" }),
  ).toBeVisible();
  failNextSubmit = true;
  await add(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "60 seconds" }),
  ).toBeVisible();
  await add(page);
  offline = true;
  await expect(page.getByRole("button", { name: "Retry updates" })).toBeVisible(
    { timeout: 7000 },
  );
  offline = false;
  frozen = false;
  await page.getByRole("button", { name: "Retry updates" }).click();
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByRole("heading", { name: product.name }),
  ).toBeVisible({ timeout: 7000 });
});
test("navigation aborts ongoing polling", async ({ page }) => {
  frozen = true;
  await start(page);
  await add(page);
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByRole("article"),
  ).toHaveCount(1);
  await page.goto("about:blank");
  const count = calls;
  await page.waitForTimeout(2300);
  expect(calls).toBe(count);
});
test("older saved imports are available through cursor pagination", async ({
  page,
}) => {
  await start(page);
  await add(page);
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByRole("article"),
  ).toHaveCount(1);
  const original = jobs.get(1)!;
  for (let id = 1; id <= 21; id++) {
    jobs.set(id, completed({ ...original, jobId: id }));
    counts.set(id, 10);
  }
  await page.reload();
  await openActivity(page);
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByRole("article"),
  ).toHaveCount(20);
  await page.getByRole("button", { name: "Load older imports" }).click();
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByRole("article"),
  ).toHaveCount(21);
  await expect(
    page.getByRole("button", { name: "Load older imports" }),
  ).toHaveCount(0);
});
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

test("Woolworths URL imports and retains its own source after refresh", async ({
  page,
}) => {
  await start(page);
  await openActivity(page);
  const url =
    "https://www.woolworths.com.au/shop/productdetails/32731/coca-cola-classic-soft-drink-bottle";
  await page.getByLabel("Product URL").fill(url);
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByRole("heading", { name: product.name }),
  ).toBeVisible({ timeout: 10000 });
  expect(sources.get(1)).toBe(url);
  const article = page
    .getByRole("region", { name: "Import history and price comparisons" })
    .getByRole("article");
  await expect(article.getByText("Woolworths", { exact: true })).toBeVisible();
  await expect(article.locator(`a[href="${url}"]`)).toBeVisible();
  await page.reload();
  await openActivity(page);
  await expect(article.locator(`a[href="${url}"]`)).toBeVisible();
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

test("stale prices update automatically without losing note drafts or requiring a reload", async ({
  page,
}) => {
  await start(page);
  await add(page);
  const list = page.getByRole("region", { name: "Editable shopping list" });
  const card = list.getByRole("article");
  await expect(card).toBeVisible({ timeout: 10000 });
  const old: PlanningPrice = {
    shopId: 1,
    shopName: "Coles",
    price: 23,
    includedInTotal: false,
    status: "Stale price",
    productUrl: "https://www.coles.com.au/product/123456",
    checkedDate: "2026-09-01T00:00:00Z",
    specialDescription: null,
    refreshStatus: "Waiting",
  };
  planningPrices.set(1, [old]);
  await page.reload();
  await expect(card.getByText(/Waiting for price update/)).toBeVisible();
  await expect(card.getByText(/Stale price/)).toBeVisible();
  await card.getByRole("button", { name: "Add note" }).click();
  await card.getByLabel("Notes").fill("Keep this draft during price updates");
  planningPrices.set(1, [{ ...old, refreshStatus: "Updating" }]);
  await expect(card.getByText("Updating price…")).toBeVisible({
    timeout: 10000,
  });
  planningPrices.set(1, [
    {
      ...old,
      price: 17,
      includedInTotal: true,
      status: "Fresh",
      refreshStatus: null,
    },
  ]);
  await expect(card.getByText("at Coles", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(card.getByText(/Stale price|Updating price/)).toHaveCount(0);
  await expect(card.getByLabel("Notes")).toHaveValue(
    "Keep this draft during price updates",
  );
  await expect(
    list
      .getByRole("region", { name: "Shopping cost summary" })
      .getByText("$17.00", { exact: true }),
  ).toHaveCount(2);
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

test("import activity is collapsed by default while prices update on the cards", async ({
  page,
}) => {
  comparison = comparable;
  await start(page);
  const activity = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: "Import activity" }),
  });
  await expect(activity).not.toHaveAttribute("open");
  await page
    .getByLabel("Product URL")
    .fill("https://www.coles.com.au/product/test");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  const card = page
    .getByRole("region", { name: "Editable shopping list" })
    .getByRole("article");
  await expect(card.getByText("at Woolworths", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(activity).not.toHaveAttribute("open");
  await openActivity(page);
  await expect(activity).toHaveAttribute("open", "");
  await page.locator("summary").filter({ hasText: "Import activity" }).click();
  await expect(activity).not.toHaveAttribute("open");
});

test("verified comparison highlights the best price and retains cache context", async ({
  page,
}, info) => {
  comparison = comparable;
  await start(page);
  await add(page);
  await expect(
    page.getByText("Best known price · national", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByText("at Woolworths", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Saved observation/)).toBeVisible();
  await expect(page.getByText("Fresh", { exact: true })).toHaveCount(2);
  await expect(page.getByText(/among 2 retailers/)).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-comparison.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await openActivity(page);
  await expect(
    page
      .getByRole("region", { name: "Import history and price comparisons" })
      .getByText("at Woolworths", { exact: true }),
  ).toBeVisible();
});

test("blocked source imports explain retailer access and survive refresh", async ({
  page,
}) => {
  comparison = (job) => ({
    ...job,
    status: "Failed",
    product: null,
    shoppingListProductId: null,
    errorCode: "retailer_access_restricted",
    retailers: [],
  });
  await start(page);
  await add(page);
  const blocked = page.getByRole("heading", {
    name: "The retailer blocked access",
  });
  await expect(blocked).toBeVisible();
  await expect(
    page.getByText(/The retailer prevented MyShoppingList/),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Check the product link and submit it again when you’re ready.",
    ),
  ).toHaveCount(0);
  expect(listItems.size).toBe(0);
  const polled = counts.get(1);
  await page.waitForTimeout(2300);
  expect(counts.get(1)).toBe(polled);
  await page.reload();
  await openActivity(page);
  await expect(blocked).toBeVisible();
  comparison = (job) => ({
    ...job,
    status: "Failed",
    product: null,
    shoppingListProductId: null,
    errorCode: "product_not_identified",
    retailers: [],
  });
  await add(page, "another");
  await expect(
    page.getByRole("heading", { name: "We couldn’t identify this product" }),
  ).toBeVisible();
});

test("unknown stores, uncertain matches and failures do not receive recommendations", async ({
  page,
}) => {
  comparison = (job) => {
    const result = comparable(job);
    return {
      ...result,
      retailers: [
        {
          ...result.retailers[0],
          prices: result.retailers[0].prices.map((p) => ({
            ...p,
            priceScope: "Unknown",
          })),
        },
        {
          ...result.retailers[1],
          status: "Likely",
          matchType: "Likely",
          prices: [],
        },
        {
          ...result.retailers[1],
          shopId: 3,
          shopName: "ALDI",
          status: "Unavailable",
          prices: [],
          errorCode: "access_restricted",
        },
      ],
    };
  };
  await start(page);
  await add(page);
  await expect(
    page.getByText("Store not verified", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Identity needs confirmation/)).toBeVisible();
  await expect(
    page.getByText(/We couldn’t check a current price/),
  ).toBeVisible();
  await expect(page.getByText(/^Best known price ·/)).toHaveCount(0);
});

test("stale prices and expired promotions remain visible with warnings", async ({
  page,
}) => {
  comparison = (job) => {
    const result = comparable(job);
    result.retailers[0].prices[0].checkedDate = new Date(
      Date.now() - 25 * 3600000,
    ).toISOString();
    result.retailers[1].prices[0].specialEndDate = new Date(
      Date.now() - 1000,
    ).toISOString();
    return result;
  };
  await start(page);
  await add(page);
  await expect(
    page.getByText("Price may be stale", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Promotion ended · price needs checking", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^Best known price ·/)).toHaveCount(0);
  await expect(page.getByText("AUD 19.00", { exact: true })).toBeVisible();
});

test("freshness updates after polling stops without another network request", async ({
  page,
}) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  comparison = (job) => {
    const result = comparable(job);
    for (const retailer of result.retailers)
      retailer.prices[0].checkedDate = new Date(
        now - 6 * 3600000 + 30000,
      ).toISOString();
    return result;
  };
  await start(page);
  await add(page);
  await expect(
    page.getByText("Best known price · national", { exact: true }),
  ).toBeVisible();
  const polled = counts.get(1);
  await page.clock.fastForward(61000);
  await expect(
    page.getByText("Refresh recommended", { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByText(/^Best known price ·/)).toHaveCount(0);
  expect(counts.get(1)).toBe(polled);
});

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
