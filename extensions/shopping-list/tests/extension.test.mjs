import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../background.js", import.meta.url),
  "utf8",
);
const {
  productUrl,
  sameProductUrl,
  createWorker,
  createPanelController,
  retailerPage,
  preferredList,
  createRefreshController,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const token = "a".repeat(64);

function refreshFixture() {
  const tabs = new Map(); const removed = []; const saved = []; const data = {};
  let owner = token; let redirected = false; let gate;
  const target = { itemId: 5, mappingId: 6, name: "Coffee", url: "https://www.coles.com.au/product/123456" };
  const browser = {
    storage: { session: { set: async v => Object.assign(data, v), remove: async k => { delete data[k]; } } },
    tabs: {
      create: async values => { tabs.set(91, { ...values, id: 91, status: "complete" }); return { id: 91 }; },
      get: async id => ({ ...tabs.get(id), ...(redirected ? { url: "https://www.coles.com.au/product/999999" } : {}) }),
      remove: async id => { removed.push(id); tabs.delete(id); },
    },
    scripting: { executeScript: async options => options.files ? [] : [{ result: { ok: true, evidence: { jsonLd: ["bounded evidence"] } } }] },
  };
  const worker = { syncSession: async () => owner,
    request: async (path, options) => {
      if (path === "/api/auth/me") return { account: { id: 1 } };
      if (path.endsWith("/price-refresh/2")) { if (gate) await gate; return [target]; }
      saved.push(options.body); return { updated: true, message: "Updated." };
    } };
  return { handle: createRefreshController(browser, worker), browser, tabs, removed, saved, data,
    changeAccount: () => { owner = "b".repeat(64); }, redirect: () => { redirected = true; },
    setGate: value => { gate = value; },
    message: { accountId: 1, listId: 2, runId: crypto.randomUUID() } };
}

test("website refresh reads only server-owned targets, updates prices and closes only its temporary tab", async () => {
  const f = refreshFixture();
  assert.deepEqual(await f.handle({ action: "hello" }), { available: true, version: 1 });
  assert.equal(f.tabs.size, 0);
  const started = await f.handle({ ...f.message, action: "start" });
  assert.equal(started.total, 1); assert.equal(started.completed, 0);
  const result = await f.handle({ ...f.message, action: "next" });
  assert.equal(result.updated, 1); assert.equal(result.done, true);
  assert.equal(f.saved[0].itemId, 5); assert.equal(f.saved[0].mappingId, 6);
  assert.equal("quantity" in f.saved[0], false);
  assert.deepEqual(f.removed, [91]); assert.equal(f.tabs.size, 0);
  assert.equal("priceRefreshTab" in f.data, false);
  assert.equal(JSON.stringify(result).includes("bounded evidence"), false);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("refresh rejects changed accounts and redirects without saving a price", async () => {
  const f = refreshFixture(); await f.handle({ ...f.message, action: "start" });
  f.redirect();
  const result = await f.handle({ ...f.message, action: "next" });
  assert.equal(result.failed, 1); assert.equal(f.saved.length, 0); assert.deepEqual(f.removed, [91]);
  const g = refreshFixture(); await g.handle({ ...g.message, action: "start" }); g.changeAccount();
  await assert.rejects(g.handle({ ...g.message, action: "next" }), /refresh has ended/);
  assert.equal(g.tabs.size, 0); assert.equal(g.saved.length, 0);
});

test("product redirects may change the slug but must keep the retailer and complete product code", () => {
  assert.equal(sameProductUrl("https://www.coles.com.au/product/coles-kitchen-supreme-pizza-445g-1435461",
    "https://www.coles.com.au/product/1435461"), true);
  assert.equal(sameProductUrl("https://woolworths.com.au/shop/productdetails/123456/new-coffee-name?tracking=1",
    "https://www.woolworths.com.au/shop/productdetails/123456/old-name"), true);
  assert.equal(sameProductUrl("https://www.aldi.com.au/product/new-name-000000000000398449",
    "https://www.aldi.com.au/product/old-name-000000000000398449"), true);
  for (const other of ["https://www.coles.com.au/product/999999",
    "https://www.woolworths.com.au/shop/productdetails/1435461",
    "https://www.coles.com.au.evil.test/product/1435461",
    "http://www.coles.com.au/product/1435461", "https://www.coles.com.au/search?q=1435461", undefined]) {
    assert.equal(sameProductUrl(other, "https://www.coles.com.au/product/1435461"), false);
  }
  assert.equal(sameProductUrl(undefined, undefined), false);
  assert.equal(sameProductUrl("https://www.aldi.com.au/product/new-name-398449",
    "https://www.aldi.com.au/product/old-name-000000000000398449"), false);
});

test("refresh follows a same-product canonical redirect, including a pending navigation", async () => {
  for (const pending of [false, true]) {
    const f = refreshFixture();
    const get = f.browser.tabs.get;
    let first = true;
    f.browser.tabs.get = async id => {
      const tab = await get(id);
      const canonical = "https://www.coles.com.au/product/coffee-500g-123456";
      if (first && pending) { first = false; return { ...tab, status: "loading", pendingUrl: canonical }; }
      return { ...tab, url: canonical };
    };
    await f.handle({ ...f.message, action: "start" });
    const result = await f.handle({ ...f.message, action: "next" });
    assert.equal(result.updated, 1); assert.equal(f.saved.length, 1);
    assert.equal(f.saved[0].mappingId, 6); assert.deepEqual(f.removed, [91]);
  }
});

test("refresh rejects a pending redirect to a different product before extraction or saving", async () => {
  const f = refreshFixture();
  const get = f.browser.tabs.get;
  f.browser.tabs.get = async id => ({ ...await get(id), pendingUrl: "https://www.coles.com.au/product/999999" });
  f.browser.scripting.executeScript = async () => assert.fail("Read a different product");
  await f.handle({ ...f.message, action: "start" });
  const result = await f.handle({ ...f.message, action: "next" });
  assert.equal(result.failed, 1); assert.equal(f.saved.length, 0); assert.deepEqual(f.removed, [91]);
});

test("refresh waits for a new tab's initial pending navigation before reading", async () => {
  const f = refreshFixture();
  const get = f.browser.tabs.get;
  let first = true;
  f.browser.tabs.get = async id => {
    if (first) { first = false; return { id, status: "loading", url: "about:blank",
      pendingUrl: "https://www.coles.com.au/product/123456" }; }
    return get(id);
  };
  await f.handle({ ...f.message, action: "start" });
  const result = await f.handle({ ...f.message, action: "next" });
  assert.equal(result.updated, 1); assert.equal(f.saved.length, 1);
});

test("cancellation also prevents a late start response from leaving an orphan run", async () => {
  const f = refreshFixture(); let release;
  f.setGate(new Promise(resolve => { release = resolve; }));
  const starting = f.handle({ ...f.message, action: "start" });
  await new Promise(resolve => setTimeout(resolve, 0));
  await f.handle({ ...f.message, action: "cancel" }); release();
  await assert.rejects(starting, /cancelled/);
  await assert.rejects(f.handle({ ...f.message, action: "next" }), /refresh has ended/);
  assert.equal(f.tabs.size, 0); assert.equal(f.saved.length, 0);
});
const aldiProduct = "https://www.aldi.com.au/product/farmdale-thickened-cream-600ml-000000000000398449";
test("ALDI reader binds the main product to its URL and heading and preserves leading zeroes", async () => {
  const context = vm.createContext({ URL, Date });
  vm.runInContext(await readFile(new URL("../content.js", import.meta.url), "utf8"), context);
  const record = { "@type": "Product", name: "Thickened Cream 600ml", brand: { name: "FARMDALE" }, offers: { "@type": "Offer", url: aldiProduct, price: "5.19", priceCurrency: "AUD" } };
  let records = [record]; let heading = record.name; let canonical = aldiProduct;
  const document = {
    title: record.name, body: { innerText: "" },
    querySelectorAll: (selector) => selector === 'script[type="application/ld+json"]' ? records.map((p) => ({ textContent: JSON.stringify(p) })) : [],
    querySelector: (selector) => selector === 'link[rel="canonical"]' ? { href: canonical } : selector.includes("h1") ? { textContent: heading } : null,
  };
  const reader = context.ColesReader;
  const value = reader.read(document, aldiProduct);
  assert.equal(value.ok, true); assert.equal(value.productId, "000000000000398449");
  assert.equal(productUrl(aldiProduct + "?utm_source=test"), aldiProduct);
  assert.equal(retailerPage(aldiProduct), true);
  assert.equal(reader.retailerProductUrl(aldiProduct).retailer, "aldi");
  assert.equal(JSON.parse(value.evidence.aldiProductJson).canonicalUrl, aldiProduct);
  assert.equal(reader.aldiUrl("https://www.aldi.com.au.evil.example/product/cream-123"), null);
  assert.equal(productUrl("https://www.aldi.com.au/products/dairy/k/123"), null);
  records = [record, record]; assert.equal(reader.read(document, aldiProduct).code, "ambiguous_product");
  records = [record]; heading = "Another product"; assert.equal(reader.read(document, aldiProduct).code, "product_identity_conflict");
  heading = record.name; canonical = aldiProduct.replace("398449", "999999"); assert.equal(reader.read(document, aldiProduct).ok, false);
  canonical = aldiProduct; delete record.offers.price;
  assert.equal(reader.read(document, aldiProduct).ok, true); // Server decides whether a usable price exists.
});

test("Coles plus slugs work in the customer URL validator and extractor", async () => {
  const context = vm.createContext({ URL, Date });
  vm.runInContext(
    await readFile(new URL("../content.js", import.meta.url), "utf8"),
    context,
  );
  for (const strength of ["50+", "50%2B", "50%2b"]) {
    const link = `https://www.coles.com.au/product/banana-boat-sport-${strength}-clear-spray-175g-9873098`;
    assert.equal(productUrl(link), link);
    assert.equal(context.ColesReader.productUrl(link).id, "9873098");
  }
  assert.equal(
    productUrl("https://www.coles.com.au/product/banana%2fboat-9873098"),
    null,
  );
});

const url = "https://www.coles.com.au/product/test-123";
function fixture(lists = [{ id: 1, name: "One" }]) {
  let data = { token };
  let cookie = { value: token, name: "myshoppinglist_session", path: "/", domain: "localhost" };
  const calls = [], removed = [], scripts = [];
  const tabs = new Map([[7, { id: 7, active: true, windowId: 11, url }]]);
  let handler;
  let readResult = { ok: true, evidence: { jsonLd: ['{"@type":"Product"}'] } };
  const browser = {
    runtime: { id: "a".repeat(32), getManifest: () => ({ version: "0.6.0" }) },
    cookies: {
      get: async () => cookie ? structuredClone(cookie) : null,
      set: async (value) => { cookie = value; return cookie; },
      remove: async () => { cookie = null; },
    },
    storage: { session: {
      get: async (keys) => Object.fromEntries((typeof keys === "string" ? [keys] : keys || Object.keys(data))
        .filter((key) => key in data).map((key) => [key, structuredClone(data[key])])),
      set: async (value) => { Object.assign(data, structuredClone(value)); },
      remove: async (keys) => { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; },
      clear: async () => { data = {}; },
    } },
    tabs: {
      get: async (id) => { if (!tabs.has(id)) throw new Error("No tab"); return structuredClone(tabs.get(id)); },
      query: async (filter) => [...tabs.values()].filter((tab) => !filter.url || tab.url.startsWith("http://localhost")),
      update: async (id, values) => { Object.assign(tabs.get(id), values); },
      remove: async (id) => { removed.push(id); tabs.delete(id); },
      sendMessage: async () => {},
      create: async () => { throw new Error("Retailer tabs must never be created"); },
    },
    scripting: { executeScript: async (options) => {
      scripts.push(options);
      return [{ result: structuredClone(readResult) }];
    } },
  };
  const fetcher = async (address, options) => {
    const path = new URL(address).pathname;
    calls.push({ url: address, path, ...options, payload: options.body ? JSON.parse(options.body) : null });
    const override = await handler?.(path, options);
    if (override) return override;
    let value;
    if (path === "/api/auth/me") value = { account: { displayName: "Test" }, shoppingListId: 1 };
    else if (path === "/api/shopping-lists") value = lists;
    else if (path === "/api/shopping-lists/default") value = { id: 10, name: "New list" };
    else if (path === "/api/user-extension/captures/preview") {
      const body = JSON.parse(options.body);
      value = { url: body.url, name: "Test product", brand: "Acme", price: 4, currency: "AUD", observedAt: body.observedAt };
    } else if (path === "/api/user-extension/captures") {
      value = { status: "Completed", productId: 1, shoppingListProductId: 1, priceSaved: true, alreadyOnList: false };
    } else if (path === "/api/user-extension/login") {
      value = { token, session: { sessionExpiresDate: new Date(Date.now() + 3600000).toISOString() } };
    } else if (path === "/api/auth/logout") return response(null, 204);
    else throw new Error("Unexpected route: " + path);
    return response(value);
  };
  return {
    browser, calls, removed, scripts, fetcher, handle: createWorker(browser, fetcher),
    data: () => data, cookie: () => cookie, setHandler: (fn) => { handler = fn; },
    setRead: (value) => { readResult = value; },
  };
}
function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}
async function preview(f) { return f.handle({ type: "preview", tabId: 7 }); }
async function save(f, quantity = 2, listId = 1) { return f.handle({ type: "save", tabId: 7, quantity, listId }); }

test("opening, state and restore never extract or collect anything", async () => {
  const f = fixture(); await f.handle.restore(); await f.handle({ type: "state" });
  assert.equal(f.scripts.length, 0); assert.equal(f.removed.length, 0);
  assert.deepEqual(f.calls.map((call) => call.path), ["/api/auth/me", "/api/shopping-lists"]);
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.permissions.includes("alarms"), false);
  assert.equal(source.includes("sharedPump"), false);
  assert.equal(source.includes("/api/contributions"), false);
});

test("each retailer requires separate explicit preview and save, with immutable evidence and date", async () => {
  for (const page of [url, aldiProduct, "https://www.woolworths.com.au/shop/productdetails/123/name"]) {
    const f = fixture();
    await f.browser.tabs.update(7, { url: page });
    await assert.rejects(save(f), /Read the current product/);
    const review = await preview(f);
    assert.equal(review.review.name, "Test product");
    assert.equal(f.calls.some((call) => call.path.endsWith("/captures")), false);
    assert.equal(JSON.stringify(review).includes("jsonLd"), false);
    assert.equal(JSON.stringify(await f.handle({ type: "state" })).includes(token), false);
    await save(f, 3);
    const [capture] = f.calls.filter((call) => call.path.endsWith("/captures"));
    const read = f.calls.find((call) => call.path.endsWith("/preview"));
    assert.deepEqual(capture.payload.evidence, read.payload.evidence);
    assert.equal(capture.payload.observedAt, read.payload.observedAt);
    assert.equal(capture.payload.quantity, 3); assert.equal(capture.payload.listId, 1);
    assert.match(capture.payload.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(capture.headers.Authorization, "Bearer " + token);
    assert.equal(capture.credentials, "omit");
    assert.equal(f.data().workflow.status, "Completed");
    assert.equal(f.removed.length, 0);
    assert.equal(f.scripts.length, 2);
  }
});

test("cancel discards an unsubmitted preview without a save or list creation", async () => {
  const f = fixture([]); await preview(f); await f.handle({ type: "cancel" });
  assert.equal(f.data().review, null);
  assert.equal(f.calls.some((call) => call.path.endsWith("/default") || call.path.endsWith("/captures")), false);
});

test("lost response survives worker restart and retry sends the identical receipt without rereading", async () => {
  const f = fixture(); await preview(f);
  f.setHandler((path) => { if (path.endsWith("/captures")) throw new TypeError("Lost reply"); });
  await assert.rejects(save(f, 4), /Lost reply/);
  const pending = structuredClone(f.data().pending);
  assert.equal((await f.handle({ type: "state" })).pending, true);
  await assert.rejects(preview(f), /Retry the unconfirmed/);
  await assert.rejects(f.handle({ type: "cancel" }), /Retry the unconfirmed/);
  const restarted = createWorker(f.browser, f.fetcher);
  await restarted.restore();
  assert.deepEqual(f.data().pending, pending);
  f.setHandler(null);
  await restarted({ type: "retry" });
  const posts = f.calls.filter((call) => call.path.endsWith("/captures"));
  assert.equal(posts.length, 2); assert.equal(posts[0].body, posts[1].body);
  assert.equal(f.scripts.length, 2); assert.equal(f.data().pending, null);
});

test("service unavailable preserves pending request and never falls back to old imports", async () => {
  const f = fixture(); await preview(f);
  f.setHandler((path) => path.endsWith("/captures") ? response({ title: "Personal capture is not enabled yet." }, 503) : null);
  await assert.rejects(save(f), /not enabled/);
  assert.ok(f.data().pending);
  assert.equal(f.calls.some((call) => call.path.includes("/imports")), false);
});

test("definitive conflicts unlock the preview without silently retrying", async () => {
  const f = fixture(); await preview(f);
  f.setHandler((path) => path.endsWith("/captures") ? response({ title: "The item was removed. Start a new capture." }, 409) : null);
  await assert.rejects(save(f), /removed/);
  assert.equal(f.data().pending, null); assert.equal(f.data().workflow.status, "Failed");
  assert.equal(f.calls.filter((call) => call.path.endsWith("/captures")).length, 1);
});

test("navigation, inactive tabs and failed extraction cannot submit a product", async () => {
  const f = fixture(); await preview(f);
  await f.browser.tabs.update(7, { url: url.replace("123", "456") });
  await assert.rejects(save(f), /same product/);
  await f.browser.tabs.update(7, { active: false });
  await assert.rejects(preview(f), /same product/);
  await f.browser.tabs.update(7, { active: true });
  f.setRead({ ok: false, code: "product_identity_conflict" });
  await assert.rejects(preview(f), /could not be read/);
  assert.equal(f.calls.some((call) => call.path.endsWith("/captures")), false);
  assert.deepEqual(f.removed, []);
});

test("quantity and owned-list checks happen before submission; default list is created only at save", async () => {
  const f = fixture(); await preview(f);
  for (const quantity of [0, 1.2, Infinity, 2147483648]) await assert.rejects(save(f, quantity), /whole-number/);
  await assert.rejects(save(f, 1, 999), /your shopping lists/);
  assert.equal(f.calls.some((call) => call.path.endsWith("/captures")), false);
  const empty = fixture([]); await preview(empty);
  assert.equal(empty.calls.some((call) => call.path.endsWith("/default")), false);
  await save(empty, 1, null);
  assert.equal(empty.calls.find((call) => call.path.endsWith("/captures")).payload.listId, 10);
  assert.ok(empty.calls.find((call) => call.path.endsWith("/default")).headers["X-Client-Timezone"]);
});

test("owned selection is remembered and deleted lists fall back safely", async () => {
  const lists = [{ id: 1 }, { id: 2 }];
  const f = fixture(lists); await f.handle({ type: "selectList", listId: 2 });
  assert.equal((await f.handle({ type: "state" })).selectedListId, 2);
  lists.pop();
  assert.equal((await f.handle({ type: "state" })).selectedListId, 1);
  assert.equal(preferredList([], 2, 1), null);
});

test("missing price is reviewable and save does not claim a verified price", async () => {
  const f = fixture();
  f.setHandler((path, options) => path.endsWith("/preview")
    ? response({ name: "Test", url, price: null, priceNotice: "Save without a price.", observedAt: JSON.parse(options.body).observedAt })
    : path.endsWith("/captures") ? response({ status: "Completed", productId: 1, shoppingListProductId: 1, priceSaved: false }) : null);
  assert.equal((await preview(f)).review.price, null);
  assert.match((await save(f)).workflow.message, /without a verified price/);
});

test("changing website account clears evidence and pending request; delayed preview is discarded", async () => {
  const f = fixture();
  let release;
  f.setHandler((path) => path.endsWith("/preview") ? new Promise((resolve) => { release = resolve; }) : null);
  const reading = preview(f);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await f.browser.cookies.set({ value: "b".repeat(64), path: "/" });
  await f.handle.syncSession();
  release(response({ url, name: "Old product", observedAt: new Date().toISOString(), price: 4 }));
  await assert.rejects(reading, /account changed/);
  assert.equal(f.data().review, undefined); assert.equal(f.data().pending, undefined);
  await assert.rejects(save(f), /Read the current product/);
});

test("sign out clears review and pending and only removes the matching website cookie", async () => {
  const f = fixture(); await preview(f);
  f.setHandler((path) => { if (path.endsWith("/captures")) throw new Error("Lost reply"); });
  await assert.rejects(save(f), /Lost reply/);
  await f.handle({ type: "logout" });
  assert.equal(f.cookie(), null); assert.equal(f.data().review, undefined); assert.equal(f.data().pending, undefined);
  assert.equal(f.removed.includes(7), false);
});

test("website sign-in recovers after storage loss and extension login uses an HTTP-only expiring cookie", async () => {
  const f = fixture(); await f.browser.storage.session.clear();
  assert.ok((await f.handle({ type: "state" })).session);
  await f.browser.cookies.remove(); await f.handle.syncSession();
  await f.handle({ type: "login", email: "test@example.test", password: "secret" });
  assert.equal(f.cookie().httpOnly, true);
  assert.ok(f.cookie().expirationDate > Date.now() / 1000);
  assert.equal(f.data().password, undefined);
});

test("401 signs out and invalid preview or save replies are never reported as success", async () => {
  const f = fixture();
  f.setHandler((path) => path.endsWith("/preview") ? response({ title: "Expired" }, 401) : null);
  await assert.rejects(preview(f), /sign in/); assert.equal(f.cookie(), null);
  const invalid = fixture();
  invalid.setHandler((path) => path.endsWith("/preview") ? response({ name: "Other", url: "https://evil.example/" }) : null);
  await assert.rejects(preview(invalid), /could not be validated/);
  assert.equal(invalid.data().review, null);
  const brokenSave = fixture(); await preview(brokenSave);
  brokenSave.setHandler((path) => path.endsWith("/captures") ? response({}) : null);
  await assert.rejects(save(brokenSave), /incomplete/); assert.ok(brokenSave.data().pending);
});
function panelFixture() {
  const f = fixture();
  const opened = [],
    closed = [];
  f.browser.runtime.getURL = (path) =>
    `chrome-extension://${f.browser.runtime.id}/${path}`;
  f.browser.sidePanel = {
    setOptions: async () => {},
    open: async (value) => opened.push(value.tabId),
    close: async (value) => { if (value.tabId != null) closed.push(value.tabId); },
  };
  return {
    ...f,
    opened,
    closed,
    panels: createPanelController(f.browser, f.handle),
  };
}
test("Hide closes the first global panel and later tab-specific panels, including after worker restart", async () => {
  const f = panelFixture();
  await f.browser.tabs.update(7, { windowId: 11, url: "chrome://newtab/" });
  const tab = await f.browser.tabs.get(7);
  let globalOpen = true;
  let tabOpen = false;
  const closes = [];
  f.browser.sidePanel.close = async (options) => {
    closes.push(options);
    if (options.tabId != null) {
      if (!tabOpen) throw new Error("No tab-specific panel is open");
      tabOpen = false;
    } else {
      assert.equal(options.windowId, 11);
      globalOpen = false;
    }
  };
  await f.panels.toolbar(tab, true);
  const restored = createPanelController(f.browser, f.handle);
  await restored.hide();
  assert.equal(globalOpen, false);
  assert.deepEqual(closes, [{ tabId: 7 }, { windowId: 11 }]);
  assert.equal(f.data().panelUi.hidden, true);
  tabOpen = true;
  await restored.toolbar(tab, true);
  await restored.hide();
  assert.equal(tabOpen, false);
  assert.equal(f.data().panelUi.hidden, true);
});
test("Chrome closing a global panel remembers Hide only for the owning window", async () => {
  const f = panelFixture();
  await f.browser.tabs.update(7, { windowId: 11 });
  await f.panels.toolbar(await f.browser.tabs.get(7), true);
  await f.panels.closed(undefined, 12);
  assert.equal(f.data().panelUi.hidden, false);
  await f.panels.closed(undefined, 11);
  assert.equal(f.data().panelUi.hidden, true);
  await f.panels.navigation(7, url);
  assert.equal((await f.panels.visible(7)).show, false);
});
test("first open is full, minimize is compact, and Hide survives navigation and worker restart", async () => {
  const f = panelFixture();
  const tab = await f.browser.tabs.get(7);
  assert.equal((await f.panels.visible(7)).show, false);
  await f.panels.toolbar(tab);
  assert.deepEqual(f.opened, [7]);
  assert.equal((await f.panels.visible(7)).show, false);
  await f.panels.minimize(7);
  assert.equal((await f.panels.visible(7)).show, true);
  await f.panels.hide();
  const restored = createPanelController(f.browser, f.handle);
  await restored.navigation(7, tab.url);
  assert.equal((await restored.visible(7)).show, false);
  await restored.toolbar(tab);
  assert.equal((await restored.visible(7)).show, true);
  assert.deepEqual(f.opened, [7]);
  await f.browser.storage.session.clear();
  await restored.toolbar(tab);
  assert.deepEqual(f.opened, [7, 7]);
});
test("navigation closes full view; unrelated pages and signed-out sessions cannot minimize", async () => {
  const f = panelFixture();
  const tab = await f.browser.tabs.get(7);
  await f.panels.toolbar(tab);
  await f.browser.tabs.update(7, { url: "https://example.com/" });
  await f.panels.navigation(7, "https://example.com/");
  assert.deepEqual(f.closed, [7]);
  assert.equal((await f.panels.visible(7)).show, false);
  await f.panels.toolbar(await f.browser.tabs.get(7));
  assert.equal(f.opened.length, 2);
  await assert.rejects(f.panels.minimize(7), /Sign in/);
  await f.browser.tabs.update(7, { url });
  await f.browser.cookies.remove();
  await assert.rejects(f.panels.minimize(7), /Sign in/);
  assert.equal((await f.panels.visible(7)).show, false);
});
test("compact frame authorization requires the current per-tab ticket and visible authenticated UI", async () => {
  const f = panelFixture();
  await f.panels.toolbar(await f.browser.tabs.get(7));
  await f.panels.minimize(7);
  const state = await f.panels.visible(7);
  const sender = {
    tab: { id: 7 },
    frameId: 1,
    url: f.browser.runtime.getURL(`compact.html?ticket=${state.ticket}`),
  };
  assert.equal(await f.panels.authorizedCompact(sender), true);
  assert.equal(
    await f.panels.authorizedCompact({ ...sender, frameId: 0 }),
    false,
  );
  assert.equal(
    await f.panels.authorizedCompact({
      ...sender,
      url: sender.url.replace(state.ticket, "invalid"),
    }),
    false,
  );
  assert.equal(
    await f.panels.authorizedCompact({
      ...sender,
      url: sender.url.replace(f.browser.runtime.id, "b".repeat(32)),
    }),
    false,
  );
  await f.panels.hide();
  assert.equal(await f.panels.authorizedCompact(sender), false);
});
test("retailer eligibility includes search pages but rejects spoofed and insecure origins", () => {
  assert.equal(
    retailerPage("https://www.coles.com.au/search/products?q=milk"),
    true,
  );
  assert.equal(retailerPage("https://www.woolworths.com.au/"), true);
  for (const value of [
    "https://coles.com.au.evil.test/",
    "http://www.coles.com.au/",
    "https://x@www.coles.com.au/",
    "chrome://extensions",
  ])
    assert.equal(retailerPage(value), false);
});
test("valid product URLs canonicalize; unrelated and misleading hosts fail", () => {
  assert.equal(productUrl(url + "?pid=tracking#fragment"), url);
  assert.ok(productUrl("https://www.coles.com.au/product/four'n-twenty-123"));
  assert.ok(
    productUrl("https://www.woolworths.com.au/shop/productdetails/123/name"),
  );
  for (const value of [
    "https://evil.com/product/test-123",
    "https://coles.com.au.evil.com/product/test-123",
    "http://coles.com.au/product/test-123",
    "https://www.coles.com.au/search/products?q=test",
    "https://x@www.coles.com.au/product/test-123",
    "chrome://extensions",
  ])
    assert.equal(productUrl(value), null);
});

test("runtime rejects retailer capture messages and forged compact frames, and binds popup actions to its actual tab", async () => {
  const f = fixture();
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  f.browser.runtime.getURL = (path) => "chrome-extension://" + f.browser.runtime.id + "/" + path;
  f.browser.runtime.onMessage = event();
  f.browser.action = { onClicked: event() };
  f.browser.tabs.onActivated = event(); f.browser.tabs.onUpdated = event();
  f.browser.storage.onChanged = event(); f.browser.cookies.onChanged = event();
  f.browser.sidePanel = { setPanelBehavior: async () => {}, onClosed: event(), setOptions: async () => {}, open: async () => {}, close: async () => {} };
  const context = vm.createContext({ chrome: f.browser, fetch: f.fetcher, URL, Date, crypto, AbortController, AbortSignal,
    setTimeout, clearTimeout, console });
  vm.runInContext(source.replace(/^export /gm, ""), context);
  await new Promise((resolve) => setImmediate(resolve));
  const listener = f.browser.runtime.onMessage.listeners[0];
  const retailer = { id: f.browser.runtime.id, url, frameId: 0, tab: { id: 7 } };
  assert.equal(listener({ type: "website-price-refresh", action: "start" }, retailer,
    () => assert.fail("Retailer initiated website refresh")), false);
  for (const sender of [
    { ...retailer, url: "http://localhost:5392/" },
    { ...retailer, url: "http://localhost:3000/", frameId: 1 },
    { ...retailer, url: "https://localhost:3000/" },
  ]) assert.equal(listener({ type: "website-price-refresh", action: "hello" }, sender,
    () => assert.fail("Untrusted website bridge accepted")), false);
  assert.equal(listener({ type: "preview" }, retailer, () => assert.fail("Retailer capture accepted")), false);
  assert.equal(listener({ type: "save" }, { ...retailer, id: "evil" }, () => assert.fail("Foreign extension accepted")), false);
  const send = (message, sender) => new Promise((resolve) => listener(message, sender, resolve));
  const hello = await send({ type: "website-price-refresh", action: "hello" },
    { ...retailer, url: "http://localhost:3000/" });
  assert.equal(hello.ok, true); assert.equal(hello.data.available, true);
  const forged = await send({ type: "save" }, { ...retailer, frameId: 1,
    url: f.browser.runtime.getURL("compact.html?ticket=forged") });
  assert.equal(forged.ok, false);
  const popup = { id: f.browser.runtime.id, url: f.browser.runtime.getURL("popup.html?tabId=7"), frameId: 0 };
  const review = await send({ type: "preview", tabId: 999 }, popup);
  assert.equal(review.ok, true); assert.equal(review.data.tabId, 7);
  assert.equal(f.scripts.every((script) => script.target.tabId === 7), true);
  assert.equal(JSON.stringify(review).includes(token), false);
  assert.equal(JSON.stringify(review).includes("jsonLd"), false);
  const saved = await send({ type: "save", tabId: 999, quantity: 1, listId: 1 }, popup);
  assert.equal(saved.ok, true);
  assert.equal(f.calls.filter((call) => call.path.endsWith("/captures")).length, 1);
});

test("zero-priced validated products remain saveable", async () => {
  const f = fixture();
  f.setHandler((path, options) => path.endsWith("/preview") ? response({
    name: "Free product", url, price: 0, currency: "AUD", observedAt: JSON.parse(options.body).observedAt,
  }) : null);
  assert.equal((await preview(f)).review.price, 0);
  assert.equal((await save(f)).workflow.status, "Completed");
});
