import { expect, test } from "@playwright/test";

test("administrator reviews evidence and explicitly saves account restrictions", async ({ page }) => {
  let account = { id: 10, email: "customer@example.test", displayName: "Customer", isPaid: false, isActive: true,
    contributionBlocked: false, contributionEnabled: true, restrictionReason: null as string | null, updatedDate: "2026-10-01T00:00:00Z" };
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/admin/accounts**", async route => {
    const request = route.request();
    if (request.method() === "PUT") {
      submitted = request.postDataJSON();
      account = { ...account, isPaid: true, contributionBlocked: true, updatedDate: "2026-10-04T00:00:00Z" };
      await route.fulfill({ status: 204 });
    } else if (new URL(request.url()).pathname.endsWith("/review")) {
      await route.fulfill({ json: { observations: [{ id: 1, source: "SharedCustomer", url: "https://www.coles.com.au/product/123", outcome: "invalid_product_evidence", receivedAt: "2026-10-04", extensionVersion: "0.2.0" }], actions: [] } });
    } else await route.fulfill({ json: [account] });
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Account administration" })).toBeVisible();
  await page.getByRole("button", { name: "Review contributions and history" }).click();
  await expect(page.getByText(/invalid_product_evidence/)).toBeVisible();
  await page.getByLabel("Paid customer").check();
  await page.getByLabel("Block contributions").check();
  await expect(page.getByRole("button", { name: "Save reviewed decision" })).toBeDisabled();
  await page.getByLabel("Review reason").fill("Repeated manipulated prices reviewed; retain shopping access");
  await page.getByRole("button", { name: "Save reviewed decision" }).click();
  await expect.poll(() => submitted).toMatchObject({ isPaid: true, contributionBlocked: true, isActive: true, expectedUpdatedDate: "2026-10-01T00:00:00Z" });
  await expect(page.getByLabel("Paid customer")).toBeChecked();
});

test("unauthorized visitors see an error without account data", async ({ page }) => {
  await page.route("**/api/admin/accounts**", route => route.fulfill({ status: 403, json: { title: "Access denied." } }));
  await page.goto("/admin");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Access denied.");
  await expect(page.getByLabel("Paid customer")).toHaveCount(0);
});
