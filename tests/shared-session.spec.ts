import { expect, test, type Page } from "@playwright/test";

const paths = ["/", "/in-store", "/settings", "/products/history", "/favorites", "/essentials", "/history"];
const timestamp = "2026-10-05T00:00:00Z";

async function fixture(page: Page) {
  const state = {
    account: { id: 1, displayName: "Alice Shopper" } as { id: number; displayName: string } | null,
    failLogout: false, logoutRequests: 0,
    logoutGate: null as Promise<void> | null,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === "/api/auth/logout") {
      state.logoutRequests++;
      await state.logoutGate;
      if (state.failLogout) return send({ title: "Unavailable" }, 503);
      state.account = null;
      return route.fulfill({ status: 204 });
    }
    const account = state.account;
    if (!account) return send({}, 401);
    const list = { id: account.id, name: `${account.displayName}'s list`, createdDate: timestamp, updatedDate: timestamp };
    if (path === "/api/auth/me") return send({
      account: { ...account, isTrial: false, isPaid: true, expiresDate: null },
      shoppingListId: account.id, sessionExpiresDate: "2099-01-01T00:00:00Z",
    });
    if (path === "/api/shopping-lists") return send([{ ...list, remainingCount: 0, retailers: [] }]);
    if (path === "/api/shopping-lists/manage") return send({ isPaid: true, limit: 5, lists: [list] });
    if (path === "/api/shopping-lists/history") return send([{ ...list, id: account.id + 100, name: `${account.displayName}'s archive` }]);
    if (path.endsWith("/plan") || path.endsWith("/in-store")) return send({
      ...list, items: [], lowest: { subtotal: 0, pricedCount: 0, missingItems: [] }, retailers: [],
      baskets: [], remainingCount: 0, splitSubtotal: 0, splitPricedCount: 0, comparableCount: 0, comparableSplitSubtotal: 0,
    });
    if (path === "/api/account/shopping-preferences") return send({
      accountId: account.id, compareOnlyPreferredShops: false, includeDifferentPackSizes: true, includeDifferentBrands: false,
      shops: [], branches: [], availableShops: [{ id: 1, name: "Coles", code: "coles", comparisonSupported: true }], updatedDate: timestamp,
    });
    if (path === "/api/account/products/preferences") return send([]);
    if (path === "/api/account/products") return send({ accountId: account.id, items: [{
      product: { id: 1, name: "Private coffee", brand: "Acme" }, isFavorite: true, isEssential: true,
      lastAddedDate: timestamp, lastPurchasedDate: null, timesAdded: 1,
    }], total: 1, nextOffset: null });
    return send({ items: [], nextBeforeId: null });
  });
  return state;
}

for (const path of paths) {
  test(`${path} switches accounts and signs out after extension session notifications`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto(path);
    const header = page.locator("header");
    await expect(header.getByRole("group", { name: "Signed in as Alice Shopper" })).toBeVisible();
    await expect(header.getByText("Alice Shopper", { exact: true })).toBeVisible();
    if (path === "/") await expect(page.getByLabel("Selected list")).toHaveValue("1");
    state.account = { id: 2, displayName: "Bob Shopper" };
    await page.evaluate(() => window.dispatchEvent(new Event("myshoppinglist-session-changed")));
    await expect(header.getByRole("group", { name: "Signed in as Bob Shopper" })).toBeVisible();
    await expect(header.getByRole("group", { name: "Signed in as Alice Shopper" })).toHaveCount(0);
    if (path === "/") {
      await expect(page.getByLabel("Selected list")).toHaveValue("2");
      await expect(page.getByRole("option", { name: "Alice Shopper's list" })).toHaveCount(0);
    }
    state.account = null;
    await page.evaluate(() => window.dispatchEvent(new Event("myshoppinglist-session-changed")));
    await expect(header.getByRole("group", { name: "Signed in as Bob Shopper" })).toHaveCount(0);
    await expect(header.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    if (path === "/" || path === "/in-store") {
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    } else {
      await expect(header.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    }
  });

  test(`${path} header signs out and clears private content`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto(path);
    const header = page.locator("header");
    await expect(header.getByRole("group", { name: "Signed in as Alice Shopper" })).toBeVisible();
    await header.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(header.getByRole("group", { name: "Signed in as Alice Shopper" })).toHaveCount(0);
    await expect(header.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Private coffee", exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Coles", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Alice Shopper's archive/ })).toHaveCount(0);
    await expect(page.getByLabel("Selected list")).toHaveCount(0);
    expect(state.logoutRequests).toBe(1);
    expect(state.account).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const path of ["/settings", "/products/history", "/favorites", "/essentials"]) {
  test(`${path} header reports sign-out failure and supports a single pending retry`, async ({ page }) => {
    const state = await fixture(page);
    state.failLogout = true;
    await page.goto(path);
    const header = page.locator("header");
    await expect(header.getByRole("group", { name: "Signed in as Alice Shopper" })).toBeVisible();
    if (path === "/settings") await expect(page.getByRole("checkbox", { name: "Coles", exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Private coffee", exact: true })).toBeVisible();
    await header.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(header.getByRole("alert")).toContainText("The service is temporarily unavailable.");
    await expect(header.getByRole("group", { name: "Signed in as Alice Shopper" })).toBeVisible();
    if (path === "/settings") await expect(page.getByRole("checkbox", { name: "Coles", exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Private coffee", exact: true })).toBeVisible();
    state.failLogout = false;
    let release!: () => void;
    state.logoutGate = new Promise<void>((resolve) => { release = resolve; });
    await header.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(header.getByRole("button", { name: "Signing out…", exact: true })).toBeDisabled();
    await expect.poll(() => state.logoutRequests).toBe(2);
    release();
    await expect(header.getByRole("group", { name: "Signed in as Alice Shopper" })).toHaveCount(0);
    await expect(header.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Private coffee", exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Coles", exact: true })).toHaveCount(0);
    expect(state.logoutRequests).toBe(2);
  });
}
