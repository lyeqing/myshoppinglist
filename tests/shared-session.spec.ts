import { expect, test } from "@playwright/test";

for (const path of ["/", "/in-store"]) {
  test(`${path} switches accounts and signs out after extension session notifications`, async ({
    page,
  }) => {
    let account: { id: number; displayName: string } | null = {
      id: 1,
      displayName: "Alice Shopper",
    };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/auth/me") {
        await route.fulfill(
          account
            ? {
                json: {
                  account: { ...account, isTrial: false, expiresDate: null },
                  shoppingListId: account.id,
                  sessionExpiresDate: "2099-01-01T00:00:00Z",
                },
              }
            : { status: 401, json: {} },
        );
      } else if (url.pathname === "/api/shopping-lists") {
        await route.fulfill({ json: [] });
      } else if (url.pathname === "/api/shopping-lists/manage") {
        await route.fulfill({
          json: {
            isPaid: false,
            limit: 2,
            lists: account
              ? [
                  {
                    id: account.id,
                    name: `${account.displayName}'s list`,
                    createdDate: "2026-10-05T00:00:00Z",
                    updatedDate: "2026-10-05T00:00:00Z",
                  },
                ]
              : [],
          },
        });
      } else if (url.pathname.endsWith("/plan")) {
        await route.fulfill({
          json: {
            id: account?.id,
            name: `${account?.displayName}'s list`,
            items: [],
            lowest: { subtotal: 0, pricedCount: 0, missingItems: [] },
            retailers: [],
          },
        });
      } else {
        await route.fulfill({ json: { items: [], nextBeforeId: null } });
      }
    });
    await page.goto(path);
    await expect(
      page.getByRole("group", { name: "Signed in as Alice Shopper" }),
    ).toBeVisible();
    if (path === "/") {
      await expect(page.getByLabel("Selected list")).toHaveValue("1");
    }
    account = { id: 2, displayName: "Bob Shopper" };
    await page.evaluate(() =>
      window.dispatchEvent(new Event("myshoppinglist-session-changed")),
    );
    await expect(
      page.getByRole("group", { name: "Signed in as Bob Shopper" }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Signed in as Alice Shopper" }),
    ).toHaveCount(0);
    if (path === "/") {
      await expect(page.getByLabel("Selected list")).toHaveValue("2");
      await expect(
        page.getByRole("option", { name: "Alice Shopper's list" }),
      ).toHaveCount(0);
    }
    account = null;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("myshoppinglist-session-changed")),
    );
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Signed in as Bob Shopper" }),
    ).toHaveCount(0);
  });
}
