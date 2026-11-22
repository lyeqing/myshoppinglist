import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.beforeAll(() => {
  if (process.env.MYSHOPPINGLIST_RESEARCH_BROWSER !== "1")
    throw new Error(
      "Start an owned API on 127.0.0.1:5499 using an explicitly disposable migrated database, then set MYSHOPPINGLIST_RESEARCH_BROWSER=1.",
    );
});
const headers = { "X-MyShoppingList-Request": "1" };

test("registration, login and research import work through the UI with the real API", async ({ page, context }) => {
  const email = `ui-journey-${randomUUID()}@example.test`;
  const password = "Disposable-UI-Research9!";
  const name = "UI research shopper";
  await page.goto("/");
  await expect(page.locator("header")).toContainText("Guest · Not signed in");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const registered = page.waitForResponse(response => response.url().endsWith("/api/auth/register") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const registration = await registered;
  expect(registration.ok(), await registration.text()).toBe(true);
  const session = await registration.json();
  await expect(page.getByRole("group", { name: `Signed in as ${name}`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain("myshoppinglist_session");
  await page.reload();
  await expect(page.getByRole("group", { name: `Signed in as ${name}`, exact: true })).toBeVisible();
  await page.locator("header").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator("header")).toContainText("Guest · Not signed in");
  await page.locator("header").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Incorrect-Password9!");
  await page.getByRole("button", { name: "Sign in to my account", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("The email or password is incorrect.");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to my account", exact: true }).click();
  await expect(page.getByRole("group", { name: `Signed in as ${name}`, exact: true })).toBeVisible();
  const identity = await context.request.get("/api/auth/me");
  expect(identity.ok()).toBe(true);
  expect((await identity.json()).account.id).toBe(session.account.id);

  await page.getByRole("link", { name: "Research products", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Research products", exact: true })).toBeVisible();
  await page.getByLabel("Product or shopping request").fill("UI research fixture");
  await page.getByLabel("Package quantity", { exact: true }).fill("3");
  let submissions = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/research" && request.method() === "POST") submissions++;
  });
  await page.getByRole("button", { name: "Prepare AI request", exact: true }).click();
  await expect(page.getByLabel("Prepared research request")).toHaveValue(/UI research fixture/);
  expect(submissions).toBe(0);
  const instructions = await context.request.get("/api/research/instructions");
  expect(instructions.ok()).toBe(true);
  const workflow = await instructions.json();
  const response = {
    query: "UI research fixture", workflowVersion: workflow.version,
    candidates: [{ key: "ui-fixture", retailer: "coles", url: "https://www.coles.com.au/product/kleenex-tissue-12345",
      identity: { name: "Kleenex UI fixture 12 rolls", brand: "Kleenex", packQuantity: 12 },
      evidence: "Synthetic UI fixture: 12 rolls, 180 sheets per roll, 3 ply. Not a live retailer price.",
      observedAt: new Date(Date.now() - 60000).toISOString(), price: 10, currency: "AUD", priceScope: "Unknown", match: "uncertain",
      tissue: { rolls: 12, sheetsPerRoll: 180, ply: 3 } }], issues: [],
  };
  await page.getByText("Import a response from an AI app that cannot submit").click();
  await page.getByLabel("AI research response").fill(JSON.stringify(response));
  await page.getByRole("button", { name: "Import for review", exact: true }).click();
  await expect(page.locator("main").getByRole("status")).toContainText("Research imported.");
  await expect(page.getByRole("heading", { name: "Kleenex UI fixture 12 rolls", exact: true })).toBeVisible();
  await expect(page.getByText("AUD 10.00 reported, unverified", { exact: true })).toBeVisible();
  const itemsUrl = `/api/shopping-lists/${session.shoppingListId}/items`;
  const beforeSelection = await context.request.get(itemsUrl);
  expect(beforeSelection.ok()).toBe(true);
  expect((await beforeSelection.json()).items).toHaveLength(0);
  await page.getByRole("button", { name: "Choose and add to list", exact: true }).click();
  await expect(page.locator("main").getByRole("status")).toContainText("Your selected product was added");
  const selected = await context.request.get(itemsUrl);
  expect(selected.ok()).toBe(true);
  const items = (await selected.json()).items;
  expect(items).toHaveLength(1);
  expect(items[0].quantity).toBe(3);
  await page.getByRole("button", { name: "Choose and add to list", exact: true }).click();
  await expect(page.locator("main").getByRole("status")).toContainText("This selection was already saved. Your list was kept unchanged.");
  expect((await (await context.request.get(itemsUrl)).json()).items).toHaveLength(1);
  const plan = await context.request.get(`/api/shopping-lists/${session.shoppingListId}/plan`);
  expect(plan.ok()).toBe(true);
  const totals = await plan.json();
  expect(totals.lowest.pricedCount).toBe(0);
  expect(totals.lowest.subtotal).toBe(0);
  await page.goto("/");
  const card = page.getByRole("region", { name: "Editable shopping list" }).getByRole("article");
  await expect(card).toContainText("Kleenex UI fixture 12 rolls");
  await expect(card.getByLabel("Item quantity", { exact: true })).toHaveText("3");
  await page.reload();
  await expect(card.getByLabel("Item quantity", { exact: true })).toHaveText("3");
  const list = page.getByRole("region", { name: "Editable shopping list" });
  await expect(list.getByRole("link", { name: "AI research", exact: true })).toHaveAttribute("href", "/research");
  await expect(page.locator('a[href="/extension"]')).toHaveCount(0);
  await list.getByText("Comparison options", { exact: true }).click();
  const comparisons = list.getByRole("region", { name: "Comparison options", exact: true });
  await expect(comparisons.getByRole("checkbox", { name: "Show different package sizes", exact: true })).toBeVisible();
  await expect(comparisons.getByRole("link", { name: "AI research", exact: true })).toHaveAttribute("href", "/research");
  await expect(comparisons).toContainText("Changing these options does not start research.");
  await expect(page.locator("main")).not.toContainText(/Chrome extension/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("ui-account-and-research.png"), fullPage: true });
});

test("real website gateway, research review, customer selection and quantity work without an extension", async ({
  page,
  context,
}) => {
  const registered = await context.request.post("/api/auth/register", {
    headers,
    data: {
      email: `research-${randomUUID()}@example.test`,
      password: "Research-Browser-Fixture9!",
      displayName: "Research shopper",
    },
  });
  expect(registered.ok()).toBe(true);
  const session = await registered.json();
  const workflow = await (
    await context.request.get("/api/research/instructions")
  ).json();
  const submitted = await context.request.post("/api/research", {
    headers,
    data: {
      requestId: randomUUID(),
      query: "Kleenex toilet tissue",
      workflowVersion: workflow.version,
      candidates: [
        {
          key: "fixture-tissue",
          retailer: "coles",
          url: "https://www.coles.com.au/product/kleenex-tissue-12345",
          identity: {
            name: "Kleenex tissue fixture 12 rolls",
            brand: "Kleenex",
            packQuantity: 12,
          },
          evidence:
            "Synthetic browser fixture: 12 rolls, 180 sheets per roll, 3 ply. Not a live price.",
          observedAt: new Date(Date.now() - 60000).toISOString(),
          price: 10,
          currency: "AUD",
          priceScope: "Unknown",
          match: "uncertain",
          tissue: { rolls: 12, sheetsPerRoll: 180, ply: 3 },
        },
      ],
      issues: [
        {
          retailer: "woolworths",
          code: "retailer_inaccessible",
          detail: "Synthetic blocked retailer outcome. No price was invented.",
        },
      ],
    },
  });
  expect(submitted.ok(), await submitted.text()).toBe(true);
  await page.goto("/research");
  await expect(
    page.getByRole("heading", { name: "Research products", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Product or shopping request")
    .fill("Kleenex toilet tissue");
  await page.getByLabel("Package quantity").fill("3");
  await page
    .getByRole("button", { name: "Prepare AI request", exact: true })
    .click();
  await expect(page.getByLabel("Prepared research request")).toHaveValue(
    /Kleenex toilet tissue/,
  );
  await expect(
    page.getByText("These links open the AI app.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Kleenex toilet tissue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Kleenex tissue fixture 12 rolls",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("AUD 10.00 reported, unverified", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic blocked retailer outcome.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Choose and add to list", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Your selected product was added",
  );
  const items = await (
    await context.request.get(
      `/api/shopping-lists/${session.shoppingListId}/items`,
    )
  ).json();
  expect(items.items).toHaveLength(1);
  expect(items.items[0].quantity).toBe(3);
  await page
    .getByRole("button", { name: "Choose and add to list", exact: true })
    .click();
  expect(
    (
      await (
        await context.request.get(
          `/api/shopping-lists/${session.shoppingListId}/items`,
        )
      ).json()
    ).items,
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Find prices needing research" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Prices needing research", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Kleenex tissue fixture 12 rolls · coles · missing price"),
  ).toBeVisible();
  const issue = page
    .getByRole("article")
    .filter({ hasText: "Synthetic blocked retailer outcome." });
  await issue
    .getByLabel("Action taken or remaining limitation")
    .fill("Could not verify the retailer price; limitation retained.");
  await issue
    .getByRole("button", { name: "Keep outcome: cannot verify" })
    .click();
  await expect(issue).toContainText("Could not verify");
  await expect(page.getByText("Product selected · 1 open issues")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("research-review.png"),
    fullPage: true,
  });
  await page.goto("/");
  const saved = page.getByRole("region", { name: "Editable shopping list" }).getByRole("article");
  await expect(saved).toContainText("Kleenex tissue fixture 12 rolls");
  await expect(saved.getByLabel("Item quantity", { exact: true })).toHaveText("3");
});

test("gateway limits, error recovery, manual entry and account switching preserve private state", async ({
  page,
  context,
}) => {
  const registration = await context.request.post("/api/auth/register", {
    headers,
    data: {
      email: `manual-${randomUUID()}@example.test`,
      password: "Research-Browser-Fixture9!",
      displayName: "Manual shopper",
    },
  });
  expect(registration.ok(), await registration.text()).toBe(true);
  const current = await registration.json();
  expect((await context.request.get("/api/research", { headers: { "X-MyShoppingList-Account": String(current.account.id + 1) } })).status()).toBe(409);
  expect(
    (await context.request.post("/api/research", { data: {} })).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post("/api/research/unauthorized", {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await context.request.get("/api/research/refresh/1?pageSize=999")
    ).status(),
  ).toBe(400);
  await page.goto("/research");
  await page
    .getByLabel("Product or shopping request")
    .fill("Unpriced pantry rice");
  await page.getByLabel("Package quantity").fill("2");
  await page.getByRole("button", { name: "Add item without a price" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Item saved without a retailer price",
  );
  await page
    .getByText("Import a response from an AI app that cannot submit")
    .click();
  await page.getByLabel("AI research response").fill("malformed response");
  await page.getByRole("button", { name: "Import for review" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "valid JSON object",
  );
  await context.request.post("/api/auth/logout", { headers });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("myshoppinglist-session-changed")),
  );
  await expect(
    page.getByText("to keep private research and select products.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("AI research response")).toHaveCount(0);
  await expect(page.getByLabel("Product or shopping request")).toHaveCount(0);
});
