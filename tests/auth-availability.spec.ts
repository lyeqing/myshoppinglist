import { expect, test, type Page } from "@playwright/test";

const session = {
  account: { id: 7, displayName: "Alex Shopper", isTrial: false, isPaid: false, expiresDate: null },
  shoppingListId: 1, sessionExpiresDate: "2099-01-01T00:00:00Z",
};

async function fixture(page: Page) {
  const state = { me: 401, malformed: false, network: false, stall: false, submit: 503, submissions: 0, trial: false };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") {
      if (state.stall) return;
      if (state.network) return route.abort("failed");
      return route.fulfill({ status: state.me, json: state.me === 200 ? state.malformed ? {} : { ...session, account: { ...session.account, isTrial: state.trial } } : {} });
    }
    if (path === "/api/auth/login" || path === "/api/auth/register") {
      state.submissions++;
      return route.fulfill({ status: state.submit, json: state.submit === 200 ? session : { title: "Check your details." } });
    }
    if (path === "/api/auth/social/providers") return route.fulfill({ json: [] });
    if (path === "/api/shopping-lists/manage") return route.fulfill({ json: { isPaid: false, limit: 2, lists: [{ id: 1, name: "Weekly" }] } });
    if (path.endsWith("/plan")) return route.fulfill({ json: { id: 1, name: "Weekly", items: [], retailers: [], lowest: { subtotal: 0, pricedCount: 0, missingItems: [] } } });
    if (path.endsWith("/shopping-preferences")) return route.fulfill({ status: 401, json: {} });
    return route.fulfill({ json: { items: [], nextBeforeId: null } });
  });
  return state;
}

test("signed-out visitors need a free account and registered account state is explicit", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/");
  await expect(page.locator("header")).toContainText("Guest · Not signed in");
  const access = page.locator("header").getByRole("group", { name: "Account access", exact: true });
  const signIn = access.getByRole("button", { name: "Sign in", exact: true });
  const createAccount = access.getByRole("button", { name: "Create an account", exact: true });
  await expect(signIn).toBeVisible();
  await expect(createAccount).toBeVisible();
  const signInBox = await signIn.boundingBox();
  const createBox = await createAccount.boundingBox();
  expect(signInBox).not.toBeNull(); expect(createBox).not.toBeNull();
  expect(Math.abs(signInBox!.y - createBox!.y)).toBeLessThan(2);
  expect(signInBox!.x + signInBox!.width).toBeLessThan(createBox!.x);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Less shopping guesswork\.\s*More organised shopping\./);
  await expect(page.getByRole("heading", { name: "Shopping should feel less scattered." })).toBeVisible();
  await expect(page.getByRole("link", { name: /extension/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create a free account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start my shopping list" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Research products", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Shop in store", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Research or add an item", exact: true })).toHaveCount(0);
  await expect(page.locator('a[href="/settings"]')).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Editable shopping list" })).toHaveCount(0);
  await expect(page.getByText("Comparison options", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("guest-landing.png"), fullPage: true });
  state.me = 200;
  await page.reload();
  await expect(page.getByRole("group", { name: "Signed in as Alex Shopper" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Research products", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Editable shopping list" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shopping should feel less scattered." })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const mode of ["register", "login"] as const) {
  test(`landing ${mode} supports keyboard access, cancellation and the shopping workspace`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto("/");
    const trigger = page.locator("header").getByRole("button", { name: mode === "register" ? "Create an account" : "Sign in", exact: true });
    await expect(trigger).toBeVisible();
    await trigger.focus(); await trigger.press("Enter");
    await expect(page.getByLabel(mode === "register" ? "Display name" : "Email", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    if (mode === "register") await page.getByLabel("Display name", { exact: true }).fill("Alex Shopper");
    await page.getByLabel("Email", { exact: true }).fill("alex@example.test");
    await page.getByLabel("Password", { exact: true }).fill("ValidPassword1!");
    state.submit = 200; state.me = 200;
    await page.getByRole("button", { name: mode === "register" ? "Create account" : "Sign in to my account", exact: true }).click();
    await expect(page.getByRole("group", { name: "Signed in as Alex Shopper", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Editable shopping list" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shopping should feel less scattered." })).toHaveCount(0);
  });
}

test("in-store deep links require sign-in before showing shopping controls", async ({ page }) => {
  await fixture(page);
  await page.goto("/in-store");
  await expect(page.getByRole("heading", { name: "Sign in to shop in store" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a free account", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Choose retailer" })).toHaveCount(0);
});

for (const mode of ["register", "login", "social"] as const) {
  test(`AI connection resumes after ${mode} and still requires explicit approval`, async ({ page }) => {
    let signedIn = false;
    let approvals = 0;
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? session : {} });
      if (path === "/api/auth/social/providers") return route.fulfill({ json: mode === "social" ? [{ provider: "google", available: true }] : [] });
      if (path === "/api/auth/social/start") return route.fulfill({ json: { authorizationUrl: "/account/social" } });
      if (path === "/api/auth/social/complete") { signedIn = true; return route.fulfill({ json: { outcome: "signed_in" } }); }
      if (path === `/api/auth/${mode}`) { signedIn = true; return route.fulfill({ status: mode === "register" ? 201 : 200, json: session }); }
      if (path === "/api/ai/oauth/preview") {
        expect(route.request().postDataJSON()).toEqual({ request_uri: "urn:pending-test-request", client_id: "test-ai" });
        return route.fulfill({ json: { accountId: "7", clientName: "Test AI", scopes: ["lists.read"], offlineAccess: false } });
      }
      if (path === "/api/ai/oauth/authorize") {
        approvals++;
        expect(route.request().postDataJSON()).toMatchObject({ request_uri: "urn:pending-test-request", client_id: "test-ai", expected_account_id: "7", decision: "approve" });
        return route.fulfill({ json: { redirectUrl: "/ai/connections" } });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto("/ai/connect?request_uri=urn%3Apending-test-request&client_id=test-ai");
    if (mode === "social") {
      await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
      await page.getByRole("button", { name: "Continue to MyShoppingList", exact: true }).click();
      await page.getByRole("link", { name: "Continue to AI permission review", exact: true }).click();
    } else {
      if (mode === "register") await page.getByRole("button", { name: "Create a free account", exact: true }).click();
      if (mode === "register") await page.getByLabel("Display name", { exact: true }).fill("Alex Shopper");
      await page.getByLabel("Email", { exact: true }).fill("alex@example.test");
      await page.getByLabel("Password", { exact: true }).fill("ValidPassword1!");
      await page.getByRole("button", { name: mode === "register" ? "Create account" : "Sign in to my account", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: "Test AI wants to connect" })).toBeVisible();
    expect(approvals).toBe(0);
    await page.getByRole("button", { name: "Allow selected permissions" }).click();
    await expect.poll(() => approvals).toBe(1);
  });
}

for (const failure of ["server", "network", "malformed", "missing-route"] as const) {
  test(`authentication ${failure} failure shows an unavailable page and recovers`, async ({ page }) => {
    const state = await fixture(page);
    state.me = failure === "server" ? 503 : failure === "missing-route" ? 404 : 200;
    state.network = failure === "network";
    state.malformed = failure === "malformed";
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (failure === "server") await page.screenshot({ path: test.info().outputPath("unavailable.png"), fullPage: true });
    await expect(page.getByText("Guest · Not signed in", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start my shopping list" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Research products", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toBeVisible();
    state.me = 401; state.network = false; state.malformed = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.locator("header")).toContainText("Guest · Not signed in");
    expect(state.submissions).toBe(0);
  });
}

test("authentication timeout shows unavailable and checking status is visible", async ({ page }) => {
  const state = await fixture(page);
  state.stall = true;
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("header")).toContainText("Loading account…");
  await page.clock.fastForward(21000);
  await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toBeVisible();
});

for (const mode of ["login", "register"] as const) {
  test(`${mode} outage replaces the form and retry never resubmits credentials`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto("/");
    if (mode === "login") await page.locator("header").getByRole("button", { name: "Sign in", exact: true }).click();
    else await page.getByRole("button", { name: "Create an account", exact: true }).click();
    if (mode === "register") await page.getByLabel("Display name").fill("Alex");
    await page.getByLabel("Email", { exact: true }).fill("alex@example.test");
    await page.getByLabel("Password", { exact: true }).fill("ValidPassword1!");
    await page.getByRole("button", { name: mode === "login" ? "Sign in to my account" : "Create account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.locator("header")).toContainText("Guest · Not signed in");
    expect(state.submissions).toBe(1);
  });
}

for (const status of [400, 401, 409, 429]) {
  test(`expected login response ${status} stays in the form`, async ({ page }) => {
    const state = await fixture(page); state.submit = status;
    await page.goto("/");
    await page.locator("header").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("alex@example.test");
    await page.getByLabel("Password", { exact: true }).fill("wrong");
    await page.getByRole("button", { name: "Sign in to my account" }).click();
    await expect(page.locator("section[aria-labelledby='account-title']").getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Temporarily unavailable" })).toHaveCount(0);
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  });
}
