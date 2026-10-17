import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type {
  ShopLocationAdminDetail,
  ShopLocationCreateRequest,
  ShopLocationUpdateRequest,
} from "../src/lib/api-types";

let server: Server;
let records: ShopLocationAdminDetail[];
let access: number, account: number, failure: number, clock: number;
let submitted: (ShopLocationCreateRequest & { expectedUpdatedDate?: string })[];
let searches: string[];
const route = "/api/admin/shop-locations";
const confirmation =
  "I checked the branch address, retailer code and operating status against the source.";
const timestamp = () =>
  new Date(Date.UTC(2026, 9, 17, 0, 0, clock++)).toISOString();
function initial(): ShopLocationAdminDetail {
  return {
    branch: {
      location: {
        id: 1,
        shopId: 1,
        shopName: "Coles",
        storeCode: "C101",
        name: "Central Market",
        address1: "1 Market Street",
        address2: null,
        suburb: "Adelaide",
        state: "SA",
        postcode: "5000",
        verifiedAt: "2026-10-16T00:00:00Z",
        branchPricesSupported: false,
      },
      isActive: true,
      sourceReference: "Official directory reference C101",
      verifiedByAccountId: 1,
      createdDate: "2026-10-16T00:00:00Z",
      updatedDate: "2026-10-16T00:00:00Z",
    },
    reviews: [],
  };
}
function snapshot(record: ShopLocationAdminDetail) {
  const loc = record.branch.location;
  return JSON.stringify({
    Name: loc.name,
    StoreCode: loc.storeCode,
    ShopId: loc.shopId,
    Address1: loc.address1,
    Suburb: loc.suburb,
    State: loc.state,
    Postcode: loc.postcode,
    IsActive: record.branch.isActive,
    SourceReference: record.branch.sourceReference,
  });
}
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (url.pathname === "/api/auth/me")
      return send(access === 401 ? 401 : 200, {
        account: {
          id: account,
          displayName: "Reviewer",
          isTrial: false,
          expiresDate: null,
        },
        shoppingListId: null,
        sessionExpiresDate: "2099-01-01T00:00:00Z",
      });
    if (access !== 200)
      return send(access, { title: "Administrator access required." });
    if (url.pathname === "/api/account/shopping-preferences")
      return send(200, {
        accountId: account,
        availableShops: [
          { id: 1, name: "Coles", code: "coles", comparisonSupported: true },
          {
            id: 2,
            name: "Woolworths",
            code: "woolworths",
            comparisonSupported: true,
          },
        ],
      });
    if (url.pathname === route && req.method === "GET") {
      searches.push(url.search);
      const shop = url.searchParams.get("shopId"),
        term = (url.searchParams.get("search") ?? "").toLowerCase();
      const items = records
        .map((x) => x.branch)
        .filter(
          (x) =>
            (!shop || x.location.shopId === Number(shop)) &&
            (!term || JSON.stringify(x.location).toLowerCase().includes(term)),
        );
      return send(200, {
        items:
          term === "many"
            ? Array.from({ length: 50 }, (_, i) => ({
                ...records[0].branch,
                location: {
                  ...records[0].branch.location,
                  id: i + 10,
                  name: `Branch ${i}`,
                },
              }))
            : items,
        hasMore: term === "many",
      });
    }
    const id = Number(url.pathname.split("/").at(-1));
    const existing = records.find((x) => x.branch.location.id === id);
    if (url.pathname.startsWith(route + "/") && req.method === "GET")
      return send(
        existing ? 200 : 404,
        existing ?? { title: "Branch not found." },
      );
    if (
      (url.pathname === route && req.method === "POST") ||
      (existing && req.method === "PUT")
    ) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as ShopLocationUpdateRequest;
      submitted.push(body);
      if (failure)
        return send(failure, {
          title:
            failure === 409
              ? "Branch changed or already exists. Reload and review."
              : "Unable to save branch.",
        });
      if (existing && body.expectedUpdatedDate !== existing.branch.updatedDate)
        return send(409, { title: "Branch changed. Reload and review." });
      const before = existing ? snapshot(existing) : null;
      const previousActive = existing?.branch.isActive;
      const stamp = timestamp();
      const d = body.details;
      const record: ShopLocationAdminDetail = existing ?? {
        branch: {
          ...initial().branch,
          location: { ...initial().branch.location, id: 2 },
          createdDate: stamp,
        },
        reviews: [],
      };
      record.branch.location = {
        ...record.branch.location,
        ...d,
        shopName: d.shopId === 1 ? "Coles" : "Woolworths",
        name: d.name!,
        verifiedAt: stamp,
      };
      record.branch.isActive = d.isActive;
      record.branch.sourceReference = body.sourceReference;
      record.branch.updatedDate = stamp;
      record.reviews.unshift({
        id: record.reviews.length + 1,
        action: !existing
          ? "Created"
          : !d.isActive
            ? "Retired"
            : previousActive === false
              ? "Reactivated"
              : "Updated",
        evidence: body.evidence,
        sourceReference: body.sourceReference,
        reviewerAccountId: account,
        reviewedAt: stamp,
        beforeJson: before,
        afterJson: snapshot(record),
      });
      if (!existing) records.push(record);
      return send(existing ? 200 : 201, record);
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
  clock = 1;
  records = [initial()];
  access = 200;
  account = 1;
  failure = 0;
  submitted = [];
  searches = [];
});
async function open(page: Page) {
  await page.goto("/admin/shop-locations");
  await expect(
    page.getByRole("button", { name: "Add branch", exact: true }),
  ).toBeEnabled();
}
async function edit(page: Page) {
  await open(page);
  await page.getByRole("button", { name: /Central Market/ }).click();
  await expect(page.getByLabel("Branch name", { exact: true })).toHaveValue(
    "Central Market",
  );
}
async function confirm(
  page: Page,
  evidence = "Verified against the official retailer branch directory.",
) {
  await page
    .getByLabel("Verification evidence or change reason")
    .fill(evidence);
  await page.getByLabel(confirmation, { exact: true }).check();
}
async function draft(page: Page) {
  await open(page);
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  await page.getByLabel("Retailer branch code", { exact: true }).fill("C202");
  await page.getByLabel("Branch name", { exact: true }).fill("Darwin Centre");
  await page
    .getByLabel("Street address", { exact: true })
    .fill("2 Centre Street");
  await page.getByLabel("Suburb", { exact: true }).fill("Darwin");
  await page
    .getByLabel("State or territory", { exact: true })
    .selectOption("NT");
  await page.getByLabel("Postcode", { exact: true }).fill("0800");
  await page
    .getByLabel("Verification source reference", { exact: true })
    .fill("Official directory C202");
}

test("create, correct, retire and reactivate with fresh evidence and history", async ({
  page,
}, info) => {
  await draft(page);
  const create = page.getByRole("button", {
    name: "Create verified branch",
    exact: true,
  });
  await expect(create).toBeDisabled();
  await confirm(page);
  await page.screenshot({
    path: info.outputPath("branch-editor.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await create.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Verified branch created." }),
  ).toBeVisible();
  expect(submitted[0].details.postcode).toBe("0800");
  expect(submitted[0]).not.toHaveProperty("confirmed");
  await expect(
    page.getByLabel("Verification evidence or change reason"),
  ).toHaveValue("");
  await expect(
    page.getByLabel(confirmation, { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByLabel("Retailer", { exact: true })).toBeDisabled();
  await expect(
    page.getByLabel("Retailer branch code", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await page.getByLabel("Branch name", { exact: true }).fill("Darwin Central");
  await confirm(page, "Corrected name from official directory.");
  await page
    .getByRole("button", { name: "Save reviewed changes", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Reviewed branch changes saved." }),
  ).toBeVisible();
  expect(submitted[1].expectedUpdatedDate).toBeTruthy();
  await page.getByLabel("Active branch", { exact: true }).uncheck();
  await confirm(page, "Closure confirmed in official directory.");
  await page
    .getByRole("button", { name: "Retire reviewed branch", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Branch retired." }),
  ).toBeVisible();
  await page.getByLabel("Active branch", { exact: true }).check();
  await confirm(page, "Reopening confirmed in official directory.");
  await page
    .getByRole("button", { name: "Reactivate reviewed branch", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Branch reactivated." }),
  ).toBeVisible();
  const history = page.getByRole("region", { name: "Branch review history" });
  await expect(history.getByRole("listitem")).toHaveCount(4);
  await history.getByText("Recorded changes", { exact: true }).first().click();
  await expect(history.getByText("No", { exact: true })).toBeVisible();
  expect(records[1].branch.location.id).toBe(2);
});
for (const status of [400, 409, 503])
  test(`create error ${status} keeps draft correctable`, async ({ page }) => {
    await draft(page);
    await confirm(page);
    failure = status;
    await page
      .getByRole("button", { name: "Create verified branch", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Branch name", { exact: true })).toHaveValue(
      "Darwin Centre",
    );
    await page.getByLabel("Retailer branch code", { exact: true }).fill("C203");
    await expect(
      page.getByLabel(confirmation, { exact: true }),
    ).not.toBeChecked();
    failure = 0;
    await confirm(page);
    await page
      .getByRole("button", { name: "Create verified branch", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Verified branch created." }),
    ).toBeVisible();
  });
test("stale update requires reload and a new confirmation", async ({
  page,
}) => {
  await edit(page);
  await confirm(page);
  records[0].branch.updatedDate = timestamp();
  records[0].branch.location.name = "Central Market Revised";
  await page
    .getByRole("button", { name: "Save reviewed changes", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Branch changed",
  );
  await expect(page.getByLabel("Branch name", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reload branch", exact: true })
    .click();
  await expect(page.getByLabel("Branch name", { exact: true })).toHaveValue(
    "Central Market Revised",
  );
  await expect(
    page.getByLabel(confirmation, { exact: true }),
  ).not.toBeChecked();
  await confirm(page);
  await page
    .getByRole("button", { name: "Save reviewed changes", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Reviewed branch changes saved." }),
  ).toBeVisible();
});
for (const status of [401, 403])
  test(`access ${status} hides private branch controls`, async ({ page }) => {
    access = status;
    await page.goto("/admin/shop-locations");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Administrator access required",
    );
    await expect(
      page.getByRole("button", { name: "Add branch", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Official directory reference C101", { exact: true }),
    ).toHaveCount(0);
  });
test("access lost on save clears the private editor", async ({ page }) => {
  await edit(page);
  await confirm(page);
  access = 403;
  await page
    .getByRole("button", { name: "Save reviewed changes", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Administrator access required",
  );
  await expect(page.getByLabel("Branch name", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Branch review history" }),
  ).toHaveCount(0);
});
test("account change before save prevents a write", async ({ page }) => {
  await edit(page);
  await confirm(page);
  account = 2;
  await page
    .getByRole("button", { name: "Save reviewed changes", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Your account changed",
  );
  expect(submitted).toHaveLength(0);
  await expect(page.getByLabel("Branch name", { exact: true })).toHaveCount(0);
});
test("session event clears an open draft", async ({ page }) => {
  await edit(page);
  await confirm(page);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("myshoppinglist-session-changed")),
  );
  await expect(page.getByLabel("Branch name", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add branch", exact: true }),
  ).toBeEnabled();
});
test("search filters, empty results, capped results and unverified records", async ({
  page,
}) => {
  records[0].branch.location.verifiedAt = null;
  records[0].branch.location.storeCode = null;
  await open(page);
  await expect(
    page.getByRole("button", { name: /Central Market/ }),
  ).toContainText("Unverified — hidden from customers");
  await page.getByRole("button", { name: /Central Market/ }).click();
  await expect(
    page.getByLabel("Retailer branch code", { exact: true }),
  ).not.toHaveAttribute("readonly");
  await page.getByLabel("Filter retailer", { exact: true }).selectOption("2");
  await page
    .getByRole("button", { name: "Search branches", exact: true })
    .click();
  await expect(page.getByText(/No branches found/)).toBeVisible();
  expect(searches.at(-1)).toContain("shopId=2");
  await page.getByLabel("Filter retailer", { exact: true }).selectOption("");
  await expect(
    page.getByRole("button", { name: "Search branches", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Branch search", { exact: true }).fill("5000");
  await page
    .getByRole("button", { name: "Search branches", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Central Market/ }),
  ).toBeVisible();
  expect(searches.at(-1)).toBe("?search=5000");
  await page.getByLabel("Branch search", { exact: true }).fill("many");
  await page
    .getByRole("button", { name: "Search branches", exact: true })
    .click();
  await expect(page.getByText(/Showing the first 50 matches/)).toBeVisible();
});
test("proxy rejects unsupported routes and invalid queries before forwarding", async ({
  request,
}) => {
  for (const query of [
    "shopId=0",
    "shopId=1&shopId=2",
    "shopId=1&extra=yes",
    `search=${"x".repeat(101)}`,
  ]) {
    const response = await request.get(`${route}?${query}`);
    expect(response.status()).toBe(400);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
  expect(searches).toHaveLength(0);
  expect((await request.delete(`${route}/1`)).status()).toBe(404);
  expect((await request.post(`${route}/1`)).status()).toBe(404);
  expect((await request.put(route)).status()).toBe(404);
});
test("proxy protects branch writes and permits a bounded unicode evidence body", async ({
  request,
}) => {
  const headers = {
    "X-MyShoppingList-Request": "1",
    "Content-Type": "application/json",
    Origin: "http://127.0.0.1:3001",
  };
  expect((await request.post(route, { data: {} })).status()).toBe(403);
  expect(
    (
      await request.post(route, {
        headers: { ...headers, Origin: "http://untrusted.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(route, {
        headers: { ...headers, "Content-Type": "text/plain" },
        data: "{}",
      })
    ).status(),
  ).toBe(415);
  expect(
    (await request.post(route, { headers, data: "x".repeat(16385) })).status(),
  ).toBe(413);
  const details = { ...records[0].branch.location, isActive: true };
  const result = await request.post(route, {
    headers,
    data: {
      details,
      sourceReference: "Official source",
      evidence: "核".repeat(1800),
    },
  });
  expect(result.status()).toBe(201);
  expect(submitted[0].evidence).toHaveLength(1800);
  expect(result.headers()["cache-control"]).toBe("no-store");
});

test("a late detail response cannot restore a discarded editor", async ({
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
  await page.route("**/api/admin/shop-locations/1", async (route) => {
    started();
    await gate;
    await route
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(records[0]),
      })
      .catch(() => {});
  });
  await page.getByRole("button", { name: /Central Market/ }).click();
  await seen;
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  release();
  await expect(
    page.getByRole("heading", { name: "Add a verified branch", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Branch name", { exact: true })).toHaveValue("");
});
test("keyboard review confirmation and submission work", async ({ page }) => {
  await draft(page);
  await page
    .getByLabel("Verification evidence or change reason")
    .fill("Verified official directory using keyboard review.");
  const check = page.getByLabel(confirmation, { exact: true });
  await check.focus();
  await page.keyboard.press("Space");
  await expect(check).toBeChecked();
  await page.keyboard.press("Tab");
  const save = page.getByRole("button", {
    name: "Create verified branch",
    exact: true,
  });
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Verified branch created." }),
  ).toBeVisible();
});
test("review history renders evidence as text", async ({ page }) => {
  await edit(page);
  await confirm(page, '<img src=x onerror="window.branchInjected=true">');
  await page
    .getByRole("button", { name: "Save reviewed changes", exact: true })
    .click();
  const history = page.getByRole("region", { name: "Branch review history" });
  await expect(history).toContainText(
    '<img src=x onerror="window.branchInjected=true">',
  );
  await expect(history.locator("img")).toHaveCount(0);
});
