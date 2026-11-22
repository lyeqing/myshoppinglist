import { expect, test } from "@playwright/test";

test("recovery explains unavailable delivery without collecting an email", async ({ page }) => {
  await page.route("**/api/auth/recovery", route => route.fulfill({ json: { enabled: false } }));
  await page.goto("/account/recovery");
  await expect(page.getByText("Password recovery is not available yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contact support for help" })).toHaveAttribute("href", "/support");
  await expect(page.getByLabel("Account email")).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("recovery retries availability without losing the private link and gives useful invalid-link feedback", async ({ page }) => {
  let checks = 0, submissions = 0;
  await page.route("**/api/diagnostics", route => route.fulfill({ status: 204 }));
  await page.route("**/api/auth/recovery", route => checks++ === 0
    ? route.fulfill({ status: 503, json: { title: "Internal details are not customer copy" } })
    : route.fulfill({ json: { enabled: true } }));
  await page.route("**/api/auth/recovery/complete", route => {
    submissions++; expect(route.request().postDataJSON().token).toBe("fixture-private-capability");
    return route.fulfill({ status: 400, json: { title: "This reset link is invalid, expired or already used. Request a new link." } });
  });
  await page.goto("/account/recovery#token=fixture-private-capability");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
  expect(new URL(page.url()).hash).toBe("");
  await page.getByRole("button", { name: "Retry availability check" }).click();
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill("Replacement-password8!");
  await page.getByLabel("Confirm new password", { exact: true }).fill("mismatch");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("do not match"); expect(submissions).toBe(0);
  await page.getByLabel("Confirm new password", { exact: true }).fill("Replacement-password8!");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Request a new link");
  await page.getByRole("button", { name: "Request a new link" }).click();
  await expect(page.getByLabel("Account email")).toBeVisible(); await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain("fixture-private-capability");
});

test("switching accounts clears password drafts and preserves the new account context", async ({ page }) => {
  let account = 1;
  await page.route("**/api/account/profile", route => route.fulfill({ json: { accountId: account, displayName: "Shopper " + account, email: "owner@example.test", updatedDate: "2026-11-22T00:00:00Z", hasPassword: true, emailChangeAvailable: false, pendingEmailId: null, pendingEmail: null, pendingEmailExpiresAt: null } }));
  await page.route("**/api/auth/me", route => route.fulfill({ json: { account: { id: account, displayName: "Shopper " + account,
    isTrial: false, expiresDate: null, isPaid: false }, shoppingListId: account, sessionExpiresDate: "2099-01-01T00:00:00Z" } }));
  await page.goto("/account/security"); await expect(page.getByRole("group", { name: "Signed in as Shopper 1" })).toBeVisible();
  await page.getByLabel("Current password", { exact: true }).fill("Old-account-password9!");
  await page.getByLabel("New password", { exact: true }).fill("Old-account-new-password8!");
  account = 2; await page.evaluate(() => window.dispatchEvent(new Event("myshoppinglist-session-changed")));
  await expect(page.getByRole("group", { name: "Signed in as Shopper 2" })).toBeVisible();
  await expect(page.getByLabel("Current password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Confirm new password", { exact: true })).toHaveValue("");
});

test("a stale account submission reloads identity and clears credentials before another attempt", async ({ page }) => {
  let account = 1;
  await page.route("**/api/account/profile", route => route.fulfill({ json: { accountId: account, displayName: "Shopper " + account, email: "owner@example.test", updatedDate: "2026-11-22T00:00:00Z", hasPassword: true, emailChangeAvailable: false, pendingEmailId: null, pendingEmail: null, pendingEmailExpiresAt: null } }));
  await page.route("**/api/auth/me", route => route.fulfill({ json: { account: { id: account, displayName: "Shopper " + account,
    isTrial: false, expiresDate: null, isPaid: false }, shoppingListId: account, sessionExpiresDate: "2099-01-01T00:00:00Z" } }));
  await page.route("**/api/auth/password", route => {
    expect(route.request().postDataJSON().expectedAccountId).toBe(1); account = 2;
    return route.fulfill({ status: 409, json: { title: "Your account changed. Review this request again." } });
  });
  await page.goto("/account/security"); await expect(page.getByRole("group", { name: "Signed in as Shopper 1" })).toBeVisible();
  await page.getByLabel("Current password", { exact: true }).fill("Old-password9!");
  await page.getByLabel("New password", { exact: true }).fill("Replacement-password8!");
  await page.getByLabel("Confirm new password", { exact: true }).fill("Replacement-password8!");
  await page.getByRole("button", { name: "Change password and sign out" }).click();
  await expect(page.getByRole("group", { name: "Signed in as Shopper 2" })).toBeVisible();
  await expect(page.getByLabel("Current password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Confirm new password", { exact: true })).toHaveValue("");
});
