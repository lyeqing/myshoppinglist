import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type {
  BrandAlternativeReviewContext,
  BrandAlternativeReviewRequest,
  BrandAlternativeReviewResponse,
  AdminAlternativeProductSearchItem,
} from "../src/lib/api-types";

let server: Server;
let data: BrandAlternativeReviewContext;
let access: number;
let account: number;
let failure: number;
let conflict: boolean;
let submitted: BrandAlternativeReviewRequest[];
let searchCalls: string[];
const route = "/api/admin/product-alternatives";
const pagePath = "/admin/product-alternatives";
function initial(): BrandAlternativeReviewContext {
  const product = (id: number, name: string, brand: string, size: number) => ({
    product: {
      id,
      name,
      brand,
      variant: null,
      packQuantity: 1,
      packSize: size,
      packUnit: "g",
      imageUrl: null,
    },
    category: "Drinks",
    subCategory: "Ground coffee",
    isDeleted: false,
    description: "Ground coffee for filter brewing.",
    itemDetail:
      "Ingredients: ground coffee. Review manufacturer information for dietary suitability.",
    gtin: null,
    manufacturerPartNumber: null,
    modelNumber: null,
    fingerprint: `fingerprint-${id}`,
  });
  return {
    product: product(1, "Acme Ground Coffee 500g", "Acme", 500),
    alternativeProduct: product(2, "Other Ground Coffee 1kg", "Other", 1000),
    reviews: [],
  };
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
    if (url.pathname === "/api/admin/accounts") return send(200, []);
    if (url.pathname === `${route}/products`) {
      const query = url.searchParams.get("search") ?? "";
      searchCalls.push(query);
      const items: AdminAlternativeProductSearchItem[] = [
        data.product,
        data.alternativeProduct,
      ];
      const term = query.toLowerCase();
      return send(200, {
        items: !term
          ? []
          : term === "many"
            ? Array.from({ length: 50 }, (_, id) => ({
                ...data.product,
                product: {
                  ...data.product.product,
                  id: id + 10,
                  name: `Saved product ${id}`,
                },
              }))
            : items.filter(
                (p) =>
                  p.product.name.toLowerCase().includes(term) ||
                  p.product.brand?.toLowerCase().includes(term) ||
                  String(p.product.id) === term,
              ),
        hasMore: term === "many",
      });
    }
    if (url.pathname === `${route}/1/2`) {
      if (req.method === "PUT") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const request = JSON.parse(raw) as BrandAlternativeReviewRequest;
        submitted.push(request);
        if (failure)
          return send(failure, { title: "Unable to save decision." });
        if (conflict) {
          data.product.fingerprint = "changed-fingerprint";
          data.product.description = "Changed manufacturer details.";
          return send(409, {
            title:
              "Product details changed. Reload and review both products before approving.",
          });
        }
        if (request.expectedReviewId !== (data.reviews[0]?.id ?? 0))
          return send(409, { title: "Review changed." });
        const review: BrandAlternativeReviewResponse = {
          id: (data.reviews[0]?.id ?? 0) + 1,
          productId: 1,
          alternativeProductId: 2,
          previousReviewId: data.reviews[0]?.id ?? null,
          approved: request.approved,
          evidence: request.evidence,
          sameUseAndFormatConfirmed: request.sameUseAndFormatConfirmed,
          dietaryAndCompositionChecked: request.dietaryAndCompositionChecked,
          reviewerAccountId: account,
          reviewedAt: new Date().toISOString(),
          needsReview: false,
        };
        data.reviews.unshift(review);
        return send(200, review);
      }
      return send(200, data);
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
  data = initial();
  access = 200;
  account = 1;
  failure = 0;
  conflict = false;
  submitted = [];
  searchCalls = [];
});

async function choose(page: Page) {
  await page.goto(pagePath);
  await page
    .getByRole("textbox", { name: "Search Product A", exact: true })
    .fill("Acme");
  await page
    .getByRole("button", { name: "Search Product A", exact: true })
    .click();
  await page.getByRole("button", { name: /Acme Ground Coffee 500g/ }).click();
  await page
    .getByRole("textbox", { name: "Search Product B", exact: true })
    .fill("Other");
  await page
    .getByRole("button", { name: "Search Product B", exact: true })
    .click();
  await page.getByRole("button", { name: /Other Ground Coffee 1kg/ }).click();
  await page
    .getByRole("button", { name: "Load product review", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Record a reviewed decision" }),
  ).toBeVisible();
}
async function evidence(page: Page) {
  await page.getByRole("checkbox", { name: /same intended use/ }).check();
  await page.getByRole("checkbox", { name: /dietary attributes/ }).check();
  await page
    .getByLabel("Review evidence or withdrawal reason")
    .fill(
      "Manufacturer details reviewed for use, format and dietary suitability. Taste can differ.",
    );
}

test("reviewer explicitly approves and withdraws a pair with history and no prefilled confirmations", async ({
  page,
}, info) => {
  await choose(page);
  await expect(
    page.getByRole("region", { name: "Review product A", exact: true }),
  ).toContainText("Ingredients: ground coffee");
  await expect(
    page.getByRole("button", { name: "Approve alternative", exact: true }),
  ).toBeDisabled();
  await evidence(page);
  await page.screenshot({
    path: `test-results/${info.project.name}-product-review.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Approve alternative", exact: true })
    .click();
  await expect(
    page.getByText("Relationship status: Approved", { exact: true }),
  ).toBeVisible();
  expect(submitted[0]).toMatchObject({
    approved: true,
    expectedReviewId: 0,
    expectedProductFingerprint: "fingerprint-1",
    expectedAlternativeFingerprint: "fingerprint-2",
    sameUseAndFormatConfirmed: true,
    dietaryAndCompositionChecked: true,
  });
  await expect(
    page.getByRole("checkbox", { name: /same intended use/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /dietary attributes/ }),
  ).not.toBeChecked();
  await page
    .getByLabel("Review evidence or withdrawal reason")
    .fill("Withdrawn after a formulation change was identified.");
  await page
    .getByRole("button", { name: "Withdraw approval", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Relationship status: Withdrawn", { exact: true }),
  ).toBeVisible();
  expect(submitted[1]).toMatchObject({
    approved: false,
    expectedReviewId: 1,
    sameUseAndFormatConfirmed: false,
    dietaryAndCompositionChecked: false,
  });
  await expect(
    page.getByRole("region", { name: "Review history" }).getByRole("listitem"),
  ).toHaveCount(2);
});

test("conflicting product edits force reload and a new review before retrying", async ({
  page,
}) => {
  await choose(page);
  await evidence(page);
  conflict = true;
  await page
    .getByRole("button", { name: "Approve alternative", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Product details changed",
  );
  await expect(
    page.getByRole("heading", { name: "Record a reviewed decision" }),
  ).toHaveCount(0);
  conflict = false;
  await page
    .getByRole("button", { name: "Reload product review", exact: true })
    .click();
  await expect(
    page.getByText("Changed manufacturer details.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /same intended use/ }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("Review evidence or withdrawal reason"),
  ).toHaveValue("");
  await evidence(page);
  await page
    .getByRole("button", { name: "Approve alternative", exact: true })
    .click();
  await expect(
    page.getByText("Relationship status: Approved", { exact: true }),
  ).toBeVisible();
  expect(submitted[1].expectedProductFingerprint).toBe("changed-fingerprint");
});

test("temporary save failures preserve the draft and can be retried", async ({
  page,
}) => {
  await choose(page);
  await evidence(page);
  failure = 503;
  await page
    .getByRole("button", { name: "Approve alternative", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await expect(
    page.getByLabel("Review evidence or withdrawal reason"),
  ).not.toHaveValue("");
  await expect(
    page.getByRole("checkbox", { name: /same intended use/ }),
  ).toBeChecked();
  failure = 0;
  await page
    .getByRole("button", { name: "Approve alternative", exact: true })
    .click();
  await expect(
    page.getByText("Relationship status: Approved", { exact: true }),
  ).toBeVisible();
});

for (const status of [401, 403])
  test(`review access ${status} clears sensitive review data and disables writes`, async ({
    page,
  }) => {
    await choose(page);
    await evidence(page);
    access = status;
    await page
      .getByRole("button", { name: "Approve alternative", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Administrator access required",
    );
    await expect(
      page.getByRole("region", { name: "Review product A", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Review evidence or withdrawal reason"),
    ).toHaveCount(0);
    expect(data.reviews).toHaveLength(0);
  });

test("account changes cannot save another reviewer's open draft", async ({
  page,
}) => {
  await choose(page);
  await evidence(page);
  account = 2;
  await page
    .getByRole("button", { name: "Approve alternative", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Your account changed",
  );
  expect(submitted).toHaveLength(0);
  await expect(
    page.getByLabel("Review evidence or withdrawal reason"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Search Product A", exact: true }),
  ).toHaveValue("");
});

test("search handles empty results, result limits, duplicate choices and retired products", async ({
  page,
}) => {
  await page.goto(pagePath);
  const search = page.getByRole("textbox", {
    name: "Search Product A",
    exact: true,
  });
  await search.fill("nothing");
  await page
    .getByRole("button", { name: "Search Product A", exact: true })
    .click();
  await expect(page.getByText(/No saved products found/)).toBeVisible();
  await search.fill("many");
  await page
    .getByRole("button", { name: "Search Product A", exact: true })
    .click();
  await expect(page.getByText(/Showing the first 50 matches/)).toBeVisible();
  await search.fill("Acme");
  await page
    .getByRole("button", { name: "Search Product A", exact: true })
    .click();
  await page.getByRole("button", { name: /Acme Ground Coffee 500g/ }).click();
  await page
    .getByRole("textbox", { name: "Search Product B", exact: true })
    .fill("Acme");
  await page
    .getByRole("button", { name: "Search Product B", exact: true })
    .click();
  await page.getByRole("button", { name: /Acme Ground Coffee 500g/ }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Choose two different products.",
  );
  data.alternativeProduct.isDeleted = true;
  await page
    .getByRole("textbox", { name: "Search Product B", exact: true })
    .fill("Other");
  await page
    .getByRole("button", { name: "Search Product B", exact: true })
    .click();
  await page.getByRole("button", { name: /Other Ground Coffee 1kg/ }).click();
  await page
    .getByRole("button", { name: "Load product review", exact: true })
    .click();
  await evidence(page);
  await expect(
    page.getByText(/Retired product — approval unavailable/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve alternative", exact: true }),
  ).toBeDisabled();
});

test("session changes clear the review and late search responses cannot restore old results", async ({
  page,
}) => {
  await choose(page);
  await evidence(page);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("myshoppinglist-session-changed")),
  );
  await expect(
    page.getByLabel("Review evidence or withdrawal reason"),
  ).toHaveCount(0);
  const search = page.getByRole("textbox", {
    name: "Search Product A",
    exact: true,
  });
  await search.fill("Acme");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/admin/product-alternatives/products?search=Acme",
    async (intercepted) => {
      await gate;
      await intercepted
        .fulfill({ json: { items: [initial().product], hasMore: false } })
        .catch(() => {});
    },
  );
  const pending = page.waitForRequest(
    "**/api/admin/product-alternatives/products?search=Acme",
  );
  await page
    .getByRole("button", { name: "Search Product A", exact: true })
    .click();
  await pending;
  await search.fill("Other");
  release();
  await page
    .getByRole("button", { name: "Search Product A", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Other Ground Coffee 1kg/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Acme Ground Coffee 500g/ }),
  ).toHaveCount(0);
});

test("review proxy validates routes, queries, JSON, origin, size and caching", async ({
  request,
}) => {
  const path = `${route}/products?search=coffee`;
  const before = searchCalls.length;
  expect((await request.get(path + "&search=tea")).status()).toBe(400);
  expect((await request.get(path + "&unknown=1")).status()).toBe(400);
  expect(
    (await request.get(`${route}/products?search=${"x".repeat(101)}`)).status(),
  ).toBe(400);
  expect(searchCalls).toHaveLength(before);
  expect((await request.post(`${route}/products`, { data: {} })).status()).toBe(
    404,
  );
  expect((await request.put(`${route}/1/2`, { data: {} })).status()).toBe(403);
  expect(
    (
      await request.put(`${route}/1/2`, {
        headers: {
          "X-MyShoppingList-Request": "1",
          Origin: "https://outside.test",
        },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.put(`${route}/1/2`, {
        headers: {
          "X-MyShoppingList-Request": "1",
          "Content-Type": "text/plain",
        },
        data: "{}",
      })
    ).status(),
  ).toBe(415);
  expect(
    (
      await request.put(`${route}/1/2`, {
        headers: {
          "X-MyShoppingList-Request": "1",
          "Content-Type": "application/json",
        },
        data: "x".repeat(17000),
      })
    ).status(),
  ).toBe(413);
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await request.get(`${route}/1/2`)).headers()["cache-control"]).toBe(
    "no-store",
  );
});
