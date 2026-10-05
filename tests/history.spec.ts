import { test, expect } from "@playwright/test";

const list = {
  id: 9,
  name: "Last weekend",
  createdDate: "2026-10-01T00:00:00Z",
  updatedDate: "2026-10-04T00:00:00Z",
};
test("paid history shows saved items and permanently deletes an archive", async ({
  page,
}) => {
  let deleted = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("auth/me"))
      return route.fulfill({
        json: {
          account: { id: 1, displayName: "Alex", isPaid: true, isTrial: false },
          shoppingListId: null,
        },
      });
    if (route.request().method() === "DELETE") {
      expect(route.request().postDataJSON()).toEqual({
        expectedUpdatedDate: list.updatedDate,
      });
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/9/history"))
      return route.fulfill({
        json: {
          list,
          items: [
            {
              id: 1,
              product: { name: "Milk" },
              quantity: 2,
              notes: "For baking",
              isPurchased: true,
            },
          ],
        },
      });
    if (path.endsWith("/history"))
      return route.fulfill({ json: deleted ? [] : [list] });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/history");
  await page.getByRole("button", { name: /Last weekend/ }).click();
  await expect(page.getByRole("heading", { name: "Milk" })).toBeVisible();
  await expect(page.getByText("Quantity 2 · Purchased")).toBeVisible();
  await expect(page.getByText("For baking")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete archived list" }).click();
  await expect(page.getByText("No archived lists yet.")).toBeVisible();
  expect(deleted).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("free accounts cannot load history data", async ({ page }) => {
  let historyRequests = 0;
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("auth/me"))
      return route.fulfill({
        json: {
          account: {
            id: 1,
            displayName: "Alex",
            isPaid: false,
            isTrial: false,
          },
          shoppingListId: 1,
        },
      });
    historyRequests++;
    return route.fulfill({ status: 403 });
  });
  await page.goto("/history");
  await expect(
    page.getByText("Shopping history is available to paid accounts only."),
  ).toBeVisible();
  expect(historyRequests).toBe(0);
  await expect(
    page.getByRole("link", { name: "History", exact: true }),
  ).toHaveCount(0);
});
