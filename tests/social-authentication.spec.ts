import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";

const session = {
  account: {
    id: 7,
    displayName: "Social shopper",
    isTrial: false,
    isPaid: true,
    expiresDate: null,
  },
  shoppingListId: 2,
  sessionExpiresDate: "2099-01-01T00:00:00Z",
};
const providers = ["google", "facebook", "microsoft"].map((provider) => ({
  provider,
  available: true,
  connected: false,
}));
async function anonymous(page: Page, available = true) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/social/providers")
      return route.fulfill({
        json: providers.map((p) => ({ ...p, available })),
      });
    if (path === "/api/auth/me")
      return route.fulfill({ status: 401, json: {} });
    if (path === "/api/auth/login")
      return route.fulfill({ status: 401, json: {} });
    return route.fulfill({ json: {}, status: 200 });
  });
}

test("sign-in offers all providers alongside password and keeps unavailable options honest", async ({
  page,
}) => {
  await anonymous(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  for (const provider of ["Google", "Facebook", "Microsoft"])
    await expect(
      page.getByRole("button", {
        name: `Continue with ${provider} — unavailable`,
      }),
    ).toBeDisabled();
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Original-password1!");
  await page.getByRole("button", { name: "Sign in to my account" }).click();
  await expect(
    page.getByText("The email or password is incorrect.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("expired social sign-in offers an explicit safe reset without silently starting another flow", async ({
  page,
}) => {
  let starts = 0,
    resets = 0;
  await anonymous(page);
  await page.route("**/api/auth/social/start", (route) => {
    starts++;
    return route.fulfill({
      status: starts === 1 ? 401 : 409,
      json: { title: "Choose your provider account again." },
    });
  });
  await page.route("**/api/auth/reset-expired", (route) => {
    resets++;
    return route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear expired session and start again" })
    .click();
  expect(resets).toBe(1);
  expect(starts).toBe(1);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Choose your provider account again" }),
  ).toBeVisible();
  expect(starts).toBe(2);
});

test("cancelling the sign-in panel prevents a delayed provider redirect", async ({
  page,
}) => {
  await anonymous(page);
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route("**/api/auth/social/start", async (route) => {
    reached();
    await gate;
    await route
      .fulfill({
        json: {
          authorizationUrl: "https://accounts.google.com/should-not-open",
        },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await started;
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  release();
  await page.unrouteAll({ behavior: "wait" });
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toHaveCount(0);
});

test("provider start for signed-out visitors gives a useful failure", async ({ page }) => {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ status: 401, json: {} });
    if (path === "/api/auth/social/providers") return route.fulfill({ json: providers });
    if (path === "/api/auth/social/start") {
      expect(route.request().postDataJSON()).toMatchObject({ provider: "google", purpose: "signin" });
      expect(route.request().postDataJSON().expectedAccountId).toBeNull();
      return route.fulfill({ status: 409, json: { title: "Sign-in could not be started. Please try again." } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Sign-in could not be started" })).toBeVisible();
});

test("completion asks before leaving a trial separate and does not write automatically", async ({
  page,
}) => {
  let writes = 0;
  await page.route("**/api/auth/social/complete", (route) => {
    writes++;
    expect(route.request().postDataJSON().leaveTrialSeparate).toBe(writes > 1);
    return route.fulfill({
      json: { outcome: writes === 1 ? "confirm_trial_switch" : "signed_in" },
    });
  });
  await page.goto("/account/social");
  expect(writes).toBe(0);
  await page
    .getByRole("button", { name: "Continue to MyShoppingList" })
    .click();
  await expect(
    page.getByText("its lists and preferences will not be merged", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Return to my trial" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Open existing account; leave trial separate",
    })
    .click();
  await expect(page.getByRole("status")).toContainText("You are signed in");
  expect(writes).toBe(2);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test("security verifies existing password before linking and explains last-method protection", async ({
  page,
}, testInfo) => {
  let verified = false;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/account/profile") return route.fulfill({ json: { accountId: 7, displayName: "Social shopper", email: "owner@example.test", updatedDate: "2026-11-22T00:00:00Z", hasPassword: true, emailChangeAvailable: false, pendingEmailId: null, pendingEmail: null, pendingEmailExpiresAt: null } });
    if (path === "/api/auth/me") return route.fulfill({ json: session });
    if (path === "/api/auth/social/methods")
      return route.fulfill({
        json: {
          hasPassword: true,
          canAddPassword: false,
          emailDeliveryAvailable: true,
          recentlyAuthenticated: verified,
          providers,
        },
      });
    if (path === "/api/auth/social/reauthenticate") {
      expect(route.request().postDataJSON()).toEqual({
        expectedAccountId: 7,
        password: "Original-password1!",
      });
      verified = true;
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/auth/social/start") {
      expect(route.request().postDataJSON()).toMatchObject({
        expectedAccountId: 7,
        provider: "microsoft",
        purpose: "link",
      });
      return route.fulfill({
        status: 409,
        json: { title: "This provider account is connected elsewhere." },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/account/security");
  await expect(
    page.getByText("Verify it’s you before making changes"),
  ).toBeVisible();
  await page
    .getByLabel("Password to verify your identity", { exact: true })
    .fill("Original-password1!");
  await page
    .getByRole("button", { name: "Verify password", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Microsoft", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "connected elsewhere" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("sign-in-methods.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("social-only last provider is protected and password drafts clear on account change", async ({
  page,
}) => {
  let account = 7;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/account/profile") return route.fulfill({ json: { accountId: account, displayName: "Social shopper", email: null, updatedDate: "2026-11-22T00:00:00Z", hasPassword: false, emailChangeAvailable: false, pendingEmailId: null, pendingEmail: null, pendingEmailExpiresAt: null } });
    if (path === "/api/auth/me")
      return route.fulfill({
        json: { ...session, account: { ...session.account, id: account } },
      });
    if (path === "/api/auth/social/methods")
      return route.fulfill({
        json: {
          hasPassword: false,
          canAddPassword: true,
          emailDeliveryAvailable: false,
          recentlyAuthenticated: true,
          providers: providers.map((p) => ({
            ...p,
            connected: p.provider === "google",
          })),
        },
      });
    return route.fulfill({ json: [] });
  });
  await page.goto("/account/security");
  await expect(
    page.getByRole("button", { name: "Disconnect Google" }),
  ).toBeDisabled();
  await expect(page.getByText("Email/password — Not set up")).toBeVisible();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Email verification is temporarily unavailable", {
      exact: false,
    }),
  ).toBeVisible();
  account = 8;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("myshoppinglist-session-changed")),
  );
  await expect(
    page.getByRole("button", { name: "Disconnect Google" }),
  ).toBeDisabled();
});

test("cancelled provider and email verification give safe feedback without persistent secrets", async ({
  page,
}) => {
  await page.goto("/account/social?error=cancelled");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "cancelled provider sign-in",
  );
  await expect(
    page.getByRole("button", { name: "Continue to MyShoppingList" }),
  ).toHaveCount(0);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: session }),
  );
  let posts = 0;
  await page.route("**/api/auth/social/password/complete", (route) => {
    posts++;
    expect(route.request().postDataJSON().token).toBe(
      "fixture-private-verification",
    );
    return route.fulfill({
      status: 409,
      json: { title: "This verification link expired. Start again." },
    });
  });
  await page.evaluate(() => {
    window.location.hash = "verify=fixture-private-verification";
  });
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page.getByLabel("New password", { exact: true }).fill("New-password2!");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("Different-password3!");
  await page
    .getByRole("button", { name: "Verify email and add password" })
    .click();
  expect(posts).toBe(0);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("New-password2!");
  await page
    .getByRole("button", { name: "Verify email and add password" })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "expired",
  );
  expect(posts).toBe(1);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain("fixture-private-verification");
});

test("gateway forwards only social cookies and fixed callbacks and rejects unsafe redirects", async ({
  request,
}, testInfo) => {
  const websiteOrigin = new URL(testInfo.project.use.baseURL!).origin;
  let calls = 0,
    unsafe = false;
  const server = createServer((incoming, outgoing) => {
    calls++;
    const callback = incoming.url?.startsWith(
      "/api/auth/social/callback/google",
    );
    outgoing.writeHead(302, {
      Location: unsafe
        ? "https://attacker.example/steal"
        : callback
          ? websiteOrigin + "/account/social"
          : "https://accounts.google.com/o/oauth2/v2/auth?state=fixture",
      "Set-Cookie": [
        callback
          ? "mssl.external=fixture; HttpOnly; Path=/; SameSite=Lax"
          : "mssl.correlation.google.fixture=N; HttpOnly; Path=/; SameSite=Lax",
        "unrelated_secret=never-forward; Path=/",
      ],
    });
    outgoing.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(5499, "127.0.0.1", resolve);
  });
  try {
    const denied = await request.post("/api/auth/social/start", {
      data: { provider: "google", purpose: "signin" },
    });
    expect(denied.status()).toBe(403);
    expect(calls).toBe(0);
    const options = {
      data: { provider: "google", purpose: "signin" },
      headers: { "X-MyShoppingList-Request": "1" },
    };
    const start = await request.post("/api/auth/social/start", options);
    expect(start.status()).toBe(200);
    expect((await start.json()).authorizationUrl).toContain(
      "https://accounts.google.com/",
    );
    expect(start.headers()["set-cookie"]).toContain(
      "mssl.correlation.google.fixture",
    );
    expect(start.headers()["set-cookie"]).not.toContain("unrelated_secret");
    const callback = await request.get(
      "/api/auth/social/callback/google?code=fixture&state=fixture",
      { maxRedirects: 0 },
    );
    expect(callback.status()).toBe(302);
    expect(callback.headers().location).toBe(websiteOrigin + "/account/social");
    expect(callback.headers()["set-cookie"]).toContain("mssl.external");
    expect(
      (
        await request.get("/api/auth/social/callback/google?unknown=secret")
      ).status(),
    ).toBe(400);
    unsafe = true;
    expect(
      (await request.post("/api/auth/social/start", options)).status(),
    ).toBe(502);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
