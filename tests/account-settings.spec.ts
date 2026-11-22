import { expect, test, type Page } from "@playwright/test";

const current = { account: { id: 7, displayName: "Taylor", email: "owner@example.test", isTrial: false, isPaid: false, expiresDate: null }, shoppingListId: 1, sessionExpiresDate: "2099-01-01T00:00:00Z" };
const original = { accountId: 7, displayName: "Taylor", email: "owner@example.test", updatedDate: "2026-11-22T00:00:00Z",
  hasPassword: true, emailChangeAvailable: true, pendingEmailId: null as string | null, pendingEmail: null as string | null, pendingEmailExpiresAt: null as string | null };
const flowId = "00000000-0000-0000-0000-000000000007";
async function fixture(page: Page) {
  const state = { profile: { ...original }, signedIn: true, nameWrites: 0, emailWrites: 0, confirmations: 0, failName: false };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (path === "/api/auth/me") return route.fulfill({ status: state.signedIn ? 200 : 401, json: state.signedIn ? { ...current, account: { ...current.account, id: state.profile.accountId, displayName: state.profile.displayName, email: state.profile.email } } : {} });
    if (path === "/api/auth/social/methods") return route.fulfill({ json: { hasPassword: state.profile.hasPassword, canAddPassword: !state.profile.hasPassword, emailDeliveryAvailable: false, recentlyAuthenticated: true, providers: [] } });
    if (path === "/api/account/profile" && method === "GET") return route.fulfill({ json: state.profile });
    if (path === "/api/account/profile" && method === "PUT") {
      state.nameWrites++;
      if (state.failName) return route.fulfill({ status: 409, json: { title: "Your account changed. Reload Account settings and try again." } });
      const data = route.request().postDataJSON(); expect(data.expectedAccountId).toBe(7); expect(data.expectedUpdatedDate).toBe(state.profile.updatedDate);
      state.profile.displayName = data.displayName; state.profile.updatedDate = "2026-11-22T00:00:01Z";
      return route.fulfill({ json: state.profile });
    }
    if (path === "/api/account/email/request") {
      state.emailWrites++; const data = route.request().postDataJSON(); expect(data.expectedEmail).toBe("owner@example.test");
      expect(data.currentPassword).toBe("Original-password9!");
      state.profile.pendingEmail = data.email; state.profile.pendingEmailId = flowId; state.profile.pendingEmailExpiresAt = "2099-01-01T00:00:00Z";
      return route.fulfill({ status: 202, json: state.profile });
    }
    if (path === "/api/account/email/cancel") {
      expect(route.request().postDataJSON().pendingEmailId).toBe(flowId);
      state.profile.pendingEmail = null; state.profile.pendingEmailId = null; state.profile.pendingEmailExpiresAt = null;
      return route.fulfill({ json: state.profile });
    }
    if (path === "/api/account/email/complete") {
      state.confirmations++; expect(route.request().postDataJSON().token).toBe(flowId + "." + "a".repeat(64));
      state.signedIn = false; return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}

test("display name can be added or removed and refreshes the account label", async ({ page }) => {
  const state = await fixture(page); await page.goto("/account/security");
  await expect(page.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
  const name = page.getByLabel("Display name", { exact: false });
  await name.fill("  Morgan  "); await page.getByRole("button", { name: "Save display name" }).click();
  await expect(page.getByRole("group", { name: "Signed in as Morgan", exact: true })).toBeVisible();
  await name.fill(""); await page.getByRole("button", { name: "Save display name" }).click();
  await expect(page.getByRole("group", { name: "Signed in as owner@example.test", exact: true })).toBeVisible();
  expect(state.nameWrites).toBe(2); await page.reload(); await expect(name).toHaveValue("");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("account-settings.png"), fullPage: true });
});

test("email change keeps the old address and supports pending cancellation", async ({ page }) => {
  const state = await fixture(page); await page.goto("/account/security");
  await page.getByLabel("New email address", { exact: true }).fill("new@example.test");
  await page.getByLabel("Current password for email change", { exact: true }).fill("Original-password9!");
  await page.getByRole("button", { name: "Send verification link", exact: true }).click();
  await expect(page.getByText("Pending verification:", { exact: false })).toContainText("new@example.test");
  await expect(page.getByText("Current email:", { exact: false })).toContainText("owner@example.test");
  await expect(page.getByLabel("Current password for email change", { exact: true })).toHaveValue("");
  expect(state.emailWrites).toBe(1); expect(state.confirmations).toBe(0);
  await page.getByRole("button", { name: "Cancel email change" }).click();
  await expect(page.getByText("Pending verification:", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Current email:", { exact: false })).toContainText("owner@example.test");
});

test("verification capability is private and email changes only after explicit confirmation", async ({ page }) => {
  const state = await fixture(page); state.profile.pendingEmailId = flowId; state.profile.pendingEmail = "new@example.test"; state.profile.pendingEmailExpiresAt = "2099-01-01T00:00:00Z";
  const token = flowId + "." + "a".repeat(64); const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  await page.goto("/account/security#email=" + token);
  const confirm = page.getByRole("button", { name: "Confirm new email and sign out" });
  await expect(confirm).toBeVisible(); expect(state.confirmations).toBe(0); expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(token);
  await confirm.click(); await expect(page.getByText("Your email address was changed and verified.", { exact: false })).toBeVisible();
  expect(state.confirmations).toBe(1); expect(requests.every(url => !url.includes(token))).toBe(true);
});

test("unavailable email delivery leaves name and password editing available", async ({ page }) => {
  const state = await fixture(page); state.profile.emailChangeAvailable = false; await page.goto("/account/security");
  await expect(page.getByText("Email verification is unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("New email address", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Display name", { exact: false })).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
});

test("stale profile edits keep the draft until the user explicitly reloads", async ({ page }) => {
  const state = await fixture(page); state.failName = true; await page.goto("/account/security");
  const name = page.getByLabel("Display name", { exact: false }); await name.fill("Unsent draft");
  await page.getByRole("button", { name: "Save display name" }).click();
  await expect(page.getByRole("region", { name: "Profile and email" }).getByRole("alert")).toContainText("Your account changed"); await expect(name).toHaveValue("Unsent draft");
  await page.getByRole("button", { name: "Reload profile" }).click(); await expect(name).toHaveValue("Taylor");
});

test("social-only accounts retain provider verification and no-password guidance", async ({ page }) => {
  const state = await fixture(page); state.profile.hasPassword = false; await page.goto("/account/security");
  await expect(page.getByText("First verify a connected provider", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Current password for email change", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change password and sign out" })).toHaveCount(0);
});

test("an account switch discards pending profile results and clears credential drafts", async ({ page }) => {
  const state = await fixture(page); let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/account/profile", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: state.profile });
    expect(route.request().postDataJSON().expectedAccountId).toBe(7);
    await pending;
    await route.fulfill({ json: { ...original, displayName: "Late old-account name" } }).catch(() => {});
  });
  await page.goto("/account/security");
  await page.getByLabel("Current password for email change", { exact: true }).fill("Private-old-account-password");
  await page.getByLabel("Display name", { exact: false }).fill("Old account draft");
  await page.getByRole("button", { name: "Save display name" }).click();
  state.profile.accountId = 8; state.profile.displayName = "Other user";
  await page.evaluate(() => window.dispatchEvent(new Event("myshoppinglist-session-changed")));
  await expect(page.getByRole("group", { name: "Signed in as Other user", exact: true })).toBeVisible();
  release();
  await expect(page.getByLabel("Display name", { exact: false })).toHaveValue("Other user");
  await expect(page.getByLabel("Current password for email change", { exact: true })).toHaveValue("");
  await expect(page.getByText("Late old-account name", { exact: true })).toHaveCount(0);
});
