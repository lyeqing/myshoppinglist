import { expect, test } from "@playwright/test";
import { adminCookie, adminSessionServer } from "./admin-session-fixture";
let stop: () => Promise<void>;
test.beforeAll(async () => { stop = await adminSessionServer(); });
test.afterAll(async () => { await stop(); });
const session = { account: { id: 17, displayName: "Billing customer", isTrial: false, isPaid: false, expiresDate: null }, shoppingListId: 2 };
const snapshot = { subscriptions: [{ id: "sub_test", status: "active", currentPeriodEnd: "2027-01-01T00:00:00Z", cancelAtPeriodEnd: true, monthlyAudCents: 1000 }],
  invoices: [{ id: "in_test", status: "paid", paidCents: 12000, currency: "aud", receiptUrl: "https://invoice.stripe.com/i/test" }],
  payments: [{ id: "ch_test", paidCents: 12000, refundedCents: 400, currency: "aud" }] };
test("billing is private, honest about test access and handles unavailable configuration", async ({ page }) => {
  await page.route("**/api/auth/me", r => r.fulfill({ json: session }));
  await page.route("**/api/billing", r => r.fulfill({ json: { enabled: false, checkoutConfigured: false, reconciledAt: null,
    entitlement: { source: "free", activeListLimit: 2 }, ...snapshot } }));
  await page.goto("/account/billing");
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.getByText("Test payments do not change your account access.", { exact: false })).toBeVisible();
  await expect(page.getByText("free · up to 2 active lists")).toBeVisible();
  await expect(page.getByText("Test checkout is not configured.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open monthly test checkout" })).toHaveCount(0);
  await expect(page.getByText("active · cancellation scheduled")).toBeVisible();
  await expect(page.getByText("Paid $120.00 · refunded $4.00")).toBeVisible();
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/billing-${test.info().project.name}.png`, fullPage: true });
});
test("failed checkout retries keep the same request and account changes clear private records", async ({ page }) => {
  await page.route("**/api/auth/me", r => r.fulfill({ json: session }));
  await page.route("**/api/billing", r => r.fulfill({ json: { enabled: true, checkoutConfigured: true, reconciledAt: null,
    entitlement: { source: "free", activeListLimit: 2 }, ...snapshot } }));
  const requests: { requestId: string; expectedAccountId: number }[] = [];
  await page.route("**/api/billing/checkout", r => { requests.push(r.request().postDataJSON()); return r.fulfill({ status: 503, json: { title: "Fixture outage" } }); });
  await page.goto("/account/billing");
  const checkout = page.getByRole("button", { name: "Open monthly test checkout" }); await checkout.click();
  await expect(page.locator("main").getByRole("alert")).toContainText("temporarily unavailable"); await checkout.click();
  await expect.poll(() => requests.length).toBe(2); expect(requests[0]).toEqual(requests[1]); expect(requests[0].expectedAccountId).toBe(17);
  await page.unroute("**/api/auth/me"); await page.route("**/api/auth/me", r => r.fulfill({ status: 401, json: {} }));
  await page.evaluate(() => window.dispatchEvent(new Event("myshoppinglist-session-changed")));
  await expect(page.getByText("Paid $120.00 · refunded $4.00")).toHaveCount(0); await expect(page.locator("main").getByRole("alert")).toContainText("session has ended");
});
test("protected admin reporting distinguishes test estimates, refunds and scheduled cancellation", async ({ page }) => {
  await adminCookie(page);
  await page.route("**/api/admin/billing", r => r.fulfill({ json: { estimatedTestMrrAudCents: 1000, scheduledCancellations: 1, failedSubscriptions: 0,
    canceledSubscriptions: 0, pending: 1, unmatched: 0, capped: false, customers: [{ accountId: 17, reconciledAt: null, snapshot }] } }));
  await page.goto("/superadmin/billing");
  await expect(page.getByRole("heading", { name: "Test billing administration" })).toBeVisible();
  await expect(page.getByText("$10.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Test estimates only; no recognised revenue.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account 17" })).toBeVisible();
});
