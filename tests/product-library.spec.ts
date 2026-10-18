import { test, expect, type Page } from "@playwright/test";
import { createServer } from "node:http";
import type { ProductLibraryItem } from "../src/lib/api-types";

const timestamp = "2026-10-17T03:00:00Z";
const product = (id: number, name: string, purchased = false): ProductLibraryItem => ({
  product: { id, name, brand: "Acme", variant: null, packQuantity: null, packSize: 500, packUnit: "g", imageUrl: null },
  isFavorite: false, isEssential: false, lastAddedDate: timestamp,
  lastPurchasedDate: purchased ? timestamp : null, timesAdded: 1,
});
async function fixture(page: Page, products = [product(1, "Coffee", true), product(2, "Bread")]) {
  const state = {
    products, owner: 1, trial: false, paid: false, reads: 0,
    failRead: false, failSave: false, failPreferences: false,
    saveGate: null as Promise<void> | null,
    preferenceGate: null as Promise<void> | null,
    writes: [] as { path: string; body: Record<string, unknown> }[],
    lists: [{ id: 1, name: "Weekly", createdDate: timestamp, updatedDate: timestamp }],
    listProducts: new Map<number, { productId: number; quantity: number }[]>([[1, [{ productId: 1, quantity: 4 }]]]),
  };
  const preference = (p: ProductLibraryItem) => ({ productId: p.product.id, isFavorite: p.isFavorite, isEssential: p.isEssential });
  const row = (id: number, quantity: number, listId: number) => ({
    item: { id, shoppingListId: listId, product: state.products.find((p) => p.product.id === id)!.product,
      quantity, notes: "Keep my usual product", isPurchased: false, purchasedDate: null, isHidden: false,
      preferredShopId: null, addedDate: timestamp, updatedDate: timestamp },
    prices: [],
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path.endsWith("/auth/me")) return send({ account: { id: state.owner, displayName: "Alex", isTrial: state.trial, isPaid: state.paid }, shoppingListId: 1 });
    if (path.endsWith("/manage")) return send({ isPaid: state.paid, limit: state.paid ? 5 : 2, lists: state.lists });
    if (path.endsWith("/account/products/preferences")) {
      const values = state.products.map(preference);
      await state.preferenceGate;
      if (Number(url.searchParams.get("expectedAccountId")) !== state.owner) return send({ title: "Your account changed." }, 409);
      if (state.failPreferences) return send({ title: "Unavailable" }, 503);
      if (state.trial) return send({ title: "Create an account to save products." }, 403);
      return send(values.filter((p) => url.searchParams.get("productIds")?.split(",").includes(String(p.productId))));
    }
    const save = path.match(/\/account\/products\/(\d+)\/preferences$/);
    if (save && method === "PUT") {
      const body = route.request().postDataJSON();
      state.writes.push({ path, body });
      await state.saveGate;
      if (body.expectedAccountId !== state.owner) return send({ title: "Your account changed." }, 409);
      if (state.failSave) return send({ title: "Unavailable" }, 503);
      const item = state.products.find((p) => p.product.id === Number(save[1]))!;
      if (body.kind === "favorite") item.isFavorite = body.selected;
      else item.isEssential = body.selected;
      return send(preference(item));
    }
    if (path.endsWith("/account/products")) {
      state.reads++;
      if (state.failRead) return send({ title: "Unavailable" }, 503);
      const view = url.searchParams.get("view");
      const filter = url.searchParams.get("filter");
      const search = (url.searchParams.get("search") ?? "").toLowerCase();
      const matches = state.products.filter((p) => (view === "history" || view === "favorites" && p.isFavorite || view === "essentials" && p.isEssential)
        && (filter === "all" || filter === "purchased" && p.lastPurchasedDate || filter === "unpurchased" && !p.lastPurchasedDate)
        && p.product.name.toLowerCase().includes(search));
      const offset = Number(url.searchParams.get("offset"));
      const count = Number(url.searchParams.get("pageSize"));
      return send({ accountId: state.owner, items: matches.slice(offset, offset + count), total: matches.length,
        nextOffset: offset + count < matches.length ? offset + count : null });
    }
    const add = path.match(/\/shopping-lists\/(\d+)\/products\/(\d+)$/);
    if (add && method === "POST") {
      const body = route.request().postDataJSON();
      state.writes.push({ path, body });
      const items = state.listProducts.get(Number(add[1])) ?? [];
      const exists = items.some((p) => p.productId === Number(add[2]));
      if (!exists) items.push({ productId: Number(add[2]), quantity: 1 });
      state.listProducts.set(Number(add[1]), items);
      return send({ itemId: Number(add[2]), alreadyOnList: exists });
    }
    if (path === "/api/shopping-lists" && method === "POST") {
      const body = route.request().postDataJSON();
      const list = { id: 2, name: body.name || "New list", createdDate: timestamp, updatedDate: timestamp };
      state.lists.push(list);
      state.listProducts.set(2, state.products.filter((p) => p.isEssential).map((p) => ({ productId: p.product.id, quantity: 1 })));
      return send(list);
    }
    if (path === "/api/shopping-lists") return send(state.lists.map((l) => ({ ...l, remainingCount: state.listProducts.get(l.id)?.length ?? 0, retailers: [] })));
    if (path.endsWith("/imports")) return send({ items: [], nextBeforeId: null });
    if (path.endsWith("/items")) return send({ items: [], nextBeforeId: null });
    const plan = path.match(/\/shopping-lists\/(\d+)\/(plan|in-store)$/);
    if (plan) {
      const id = Number(plan[1]);
      return send({ id, name: state.lists.find((list) => list.id === id)?.name, retailers: [],
        items: (state.listProducts.get(id) ?? []).map((item) => row(item.productId, item.quantity, id)),
        lowest: { shopId: null, name: "Lowest total across shops", subtotal: 0, pricedCount: 0, missingItems: [] },
        baskets: [], remainingCount: 1, splitSubtotal: 0, splitPricedCount: 0, comparableCount: 0, comparableSplitSubtotal: 0,
      });
    }
    return route.fulfill({ status: 404 });
  });
  return state;
}

test("free product history filters, searches and toggles independent badges with keyboard access", async ({ page }, info) => {
  const state = await fixture(page);
  await page.goto("/products/history");
  await expect(page.getByRole("heading", { name: "Product history", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByRole("combobox", { name: "Purchase history", exact: true }).selectOption("purchased");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Coffee", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Purchase history", exact: true }).selectOption("unpurchased");
  await expect(page.getByRole("heading", { name: "Bread", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Purchase history", exact: true }).selectOption("all");
  await page.getByRole("searchbox", { name: "Search products" }).fill("coffee");
  await expect(page.getByRole("article")).toHaveCount(1);
  const favorite = page.getByRole("button", { name: "Add Coffee to Favorites", exact: true });
  await favorite.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Coffee from Favorites" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Add Coffee to Essentials" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Remove Coffee from Essentials" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Remove Coffee from Favorites" }).click();
  await expect(page.getByRole("button", { name: "Add Coffee to Favorites" })).toHaveAttribute("aria-pressed", "false");
  expect(state.products[0].isEssential).toBe(true);
  await page.screenshot({ path: `test-results/${info.project.name}-product-history.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Favorites and Essentials are separate pages and removing a badge updates the page", async ({ page }) => {
  const state = await fixture(page);
  state.products[0].isFavorite = true; state.products[0].isEssential = true;
  await page.goto("/favorites");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove Coffee from Favorites" }).click();
  await expect(page.getByText(/No Favorites yet/)).toBeVisible();
  await page.getByRole("link", { name: "Essentials", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Coffee from Essentials" })).toBeEnabled();
  await page.getByRole("button", { name: "Remove Coffee from Essentials" }).click();
  await expect(page.getByText(/No Essentials yet/)).toBeVisible();
});

test("saved products add at quantity one and an existing item keeps its quantity", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/products/history");
  const coffee = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Coffee", exact: true }) });
  const bread = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Bread", exact: true }) });
  await coffee.getByRole("button", { name: "Add to list", exact: true }).click();
  await expect(page.getByText(/Already on “Weekly”/)).toBeVisible();
  expect(state.listProducts.get(1)![0].quantity).toBe(4);
  await bread.getByRole("button", { name: "Add to list", exact: true }).click();
  await expect(page.getByText(/Added to “Weekly” at quantity 1/)).toBeVisible();
  expect(state.listProducts.get(1)).toContainEqual({ productId: 2, quantity: 1 });
  await bread.getByRole("button", { name: "Add to list", exact: true }).click();
  await expect(page.getByText(/Already on “Weekly”/)).toBeVisible();
  expect(state.listProducts.get(1)).toHaveLength(2);
});

test("Essentials selected on a shopping-list card appear in the next new list at quantity one", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add Coffee to Essentials", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Coffee from Essentials" })).toBeEnabled();
  await page.getByLabel("New list name (optional)").fill("Next shop");
  await page.getByRole("button", { name: "Create new list" }).click();
  await expect(page.getByLabel("Selected list")).toHaveValue("2");
  expect(state.listProducts.get(2)).toEqual([{ productId: 1, quantity: 1 }]);
  await expect(page.getByRole("button", { name: "Remove Coffee from Essentials" })).toBeEnabled();
  await page.getByRole("button", { name: "Remove Coffee from Essentials" }).click();
  await expect(page.getByRole("button", { name: "Add Coffee to Essentials" })).toBeEnabled();
  expect(state.listProducts.get(2)).toHaveLength(1);
});

test("badge failures preserve confirmed selection and retry works without duplicate writes", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/products/history");
  state.failSave = true;
  await page.getByRole("button", { name: "Add Coffee to Favorites" }).click();
  const settings = page.getByRole("group", { name: "Saved settings for Coffee" });
  await expect(settings.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByRole("button", { name: "Add Coffee to Favorites" })).toHaveAttribute("aria-pressed", "false");
  state.failSave = false;
  let release!: () => void;
  state.saveGate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await page.getByRole("button", { name: "Add Coffee to Favorites" }).click();
    await expect(page.getByRole("button", { name: "Add Coffee to Favorites" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add Coffee to Essentials" })).toBeDisabled();
    await expect(settings.getByText("Saving product settings…")).toBeVisible();
    expect(state.writes).toHaveLength(2);
  } finally { state.saveGate = null; release(); }
  await expect(page.getByRole("button", { name: "Remove Coffee from Favorites" })).toBeEnabled();
});

test("product-loading failures can be retried and trial accounts are guided to register", async ({ page }) => {
  const state = await fixture(page);
  state.failRead = true;
  await page.goto("/products/history");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
  state.failRead = false;
  await page.getByRole("button", { name: "Retry products" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  state.trial = true;
  await page.reload();
  await expect(page.getByText(/to keep product history and save Favorites and Essentials/)).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("badge loading failures keep shopping usable and offer a retry", async ({ page }) => {
  const state = await fixture(page);
  state.failPreferences = true;
  await page.goto("/");
  const settings = page.getByRole("group", { name: "Saved settings for Coffee" });
  await expect(settings.getByRole("status")).toContainText("temporarily unavailable");
  await expect(settings.getByRole("button", { name: "Add Coffee to Favorites" })).toBeDisabled();
  await expect(page.getByText("Keep my usual product", { exact: true })).toBeVisible();
  state.failPreferences = false;
  await settings.getByRole("button", { name: "Retry product settings" }).click();
  await expect(settings.getByRole("button", { name: "Add Coffee to Favorites" })).toBeEnabled();
  expect(state.writes).toHaveLength(0);
});

test("account changes clear old products and discard an outstanding badge save", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/products/history");
  let release!: () => void;
  state.saveGate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await page.getByRole("button", { name: "Add Coffee to Favorites" }).click();
    await expect(page.getByRole("button", { name: "Add Coffee to Favorites" })).toBeDisabled();
    state.owner = 2; state.products = [];
    await page.evaluate(() => window.dispatchEvent(new Event("myshoppinglist-session-changed")));
    await expect(page.getByRole("heading", { name: "Coffee", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Products will appear here/)).toBeVisible();
  } finally { state.saveGate = null; release(); }
  await expect(page.getByRole("button", { name: /Remove Coffee/ })).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("pagination appends products and changing filters resets the page", async ({ page }) => {
  await fixture(page, Array.from({ length: 26 }, (_, i) => product(i + 1, `Product ${i + 1}`, i === 0)));
  await page.goto("/products/history");
  await expect(page.getByRole("article")).toHaveCount(24);
  await page.getByRole("button", { name: "Load more products" }).click();
  await expect(page.getByRole("article")).toHaveCount(26);
  await expect(page.getByRole("button", { name: "Load more products" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Purchase history", exact: true }).selectOption("purchased");
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("the proxy allows only product-library routes, safe filters and protected JSON writes", async ({ request }) => {
  const received: string[] = [];
  const server = createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(5499, "127.0.0.1", resolve));
  try {
    const read = await request.get("/api/account/products?view=history&search=coffee&filter=purchased&pageSize=24&offset=0");
    expect(read.status()).toBe(200);
    expect(received[0]).toContain("search=coffee");
    expect((await request.get("/api/account/products?search=a&search=b")).status()).toBe(400);
    expect((await request.get("/api/account/products?unknown=yes")).status()).toBe(400);
    expect((await request.put("/api/account/products/1/preferences", { data: { kind: "favorite", selected: true, expectedAccountId: 1 } })).status()).toBe(403);
    expect((await request.put("/api/account/products/1/preferences", { headers: { "X-MyShoppingList-Request": "1" }, data: { kind: "favorite", selected: true, expectedAccountId: 1 } })).status()).toBe(200);
    expect((await request.post("/api/shopping-lists/1/products/1", { headers: { "X-MyShoppingList-Request": "1" }, data: { expectedAccountId: 1 } })).status()).toBe(200);
    expect((await request.put("/api/account/products/1/preferences", { headers: { "X-MyShoppingList-Request": "1", "Content-Type": "text/plain" }, data: "{}" })).status()).toBe(415);
    expect((await request.delete("/api/account/products/1/preferences", { headers: { "X-MyShoppingList-Request": "1" } })).status()).toBe(404);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
