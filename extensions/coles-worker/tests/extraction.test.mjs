import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../content.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({ URL, Date });
vm.runInContext(source, context);
const { extract, productUrl, read } = context.ColesReader;
const url = "https://www.coles.com.au/product/coles-kitchen-supreme-pizza-445g-1435461";
const ld = () => ({ "@type": "Product", sku: "1435461", name: "Coles Kitchen Supreme Pizza 445g", offers: { price: 7, priceCurrency: "AUD", url } });
const next = () => ({ id: 1435461, name: "Supreme Pizza", brand: "Coles Kitchen", size: "445g", pricing: { now: 7, offerDescription: "Pick any 2 for $12", multiBuyPromotion: { reward: 6 }, unit: { price: 1.57, ofMeasureQuantity: 100, ofMeasureUnits: "g" } } });
function snapshot(product = next(), structured = ld()) {
  return { url, scripts: [
    { id: "__NEXT_DATA__", text: JSON.stringify({ props: { pageProps: { product } } }) },
    { type: "application/ld+json", text: JSON.stringify(structured) }
  ] };
}
test("Coles URL validation rejects arbitrary hosts, schemes, credentials and ports", () => {
  for (const bad of ["http://www.coles.com.au/product/123", "https://evil.example/product/123", "https://www.coles.com.au.evil.example/product/123", "https://user@www.coles.com.au/product/123", "https://www.coles.com.au:444/product/123", "https://www.coles.com.au/account", "https://www.coles.com.au/product/../account-123", "https://www.coles.com.au\\@evil.example/product/123"])
    assert.equal(productUrl(bad), null, bad);
  assert.equal(productUrl("https://www.coles.com.au/product/coke-1.25l-123011?pid=tracking").id, "123011");
  assert.equal(productUrl(url + "?pid=tracking").url, url);
});
test("single-item price stays separate from multibuy reward and variant prices", () => {
  const product = next(); product.variations = { bySizes: [{ id: 999, pricing: { now: 1 } }] };
  const result = extract(snapshot(product), "1435461");
  assert.equal(result.ok, true); assert.equal(result.price, 7);
  assert.equal(result.promotion, "Pick any 2 for $12"); assert.equal(result.pack, "445g");
  assert.equal(result.unitPrice, 1.57); assert.equal(result.location, null);
  assert.equal(result.priceScope, "unverified_browser_context");
});
test("mismatching requested ID or embedded identity is rejected", () => {
  assert.equal(extract(snapshot(), "999").code, "product_identity_conflict");
  assert.equal(extract(snapshot({ ...next(), id: 999 })).code, "product_identity_conflict");
});
test("price conflicts retain identity but suppress the offer", () => {
  const structured = ld(); structured.offers.price = 6;
  const result = extract(snapshot(next(), structured));
  assert.equal(result.ok, true); assert.equal(result.price, null); assert.equal(result.priceIssue, "price_conflict");
});
test("invalid currency, negative, nonfinite and malformed prices are never displayed", () => {
  for (const price of [-1, "NaN", "Infinity", "7 dollars", "1e3", 100000000]) {
    const product = next(); product.pricing.now = price;
    assert.equal(extract(snapshot(product)).priceIssue, "invalid_price");
  }
  const structured = ld(); structured.offers.priceCurrency = "USD";
  assert.equal(extract(snapshot(next(), structured)).priceIssue, "invalid_currency");
});
test("multibuy-only data never becomes a single-item price", () => {
  const product = next(); delete product.pricing.now;
  const result = extract(snapshot(product, null));
  assert.equal(result.price, null); assert.equal(result.priceIssue, "price_unavailable");
  assert.equal(result.promotion, "Pick any 2 for $12");
});
test("unrelated and multiple offers cannot supply a guessed price", () => {
  const structured = ld(); structured.offers.url = "https://www.coles.com.au/product/999";
  assert.equal(extract(snapshot(null, structured)).priceIssue, "price_unavailable");
  structured.offers = [ld().offers, ld().offers];
  assert.equal(extract(snapshot(null, structured)).priceIssue, "ambiguous_price");
});
test("malformed data and page titles alone never establish identity", () => {
  assert.equal(extract({ url, scripts: [] }).code, "product_not_identified");
  assert.equal(extract({ url, scripts: [{ type: "application/ld+json", text: "{broken" }] }).code, "product_not_identified");
  const structured = ld(); structured.sku = "999";
  assert.equal(extract(snapshot(null, structured)).code, "product_not_identified");
});
test("JSON-LD graph and embedded state work independently", () => {
  assert.equal(extract(snapshot(null, { "@graph": [ld()] })).price, 7);
  assert.equal(extract(snapshot(next(), null)).price, 7);
  assert.equal(extract(snapshot(null, [ld(), ld()])).code, "ambiguous_product");
});
test("blocked and oversized pages are explicit failures", () => {
  assert.equal(extract({ ...snapshot(), blocked: true }).code, "retailer_access_restricted");
  assert.equal(extract({ url, scripts: [{ text: "x".repeat(2000001) }] }).code, "page_too_large");
  assert.equal(extract({ url, scripts: Array.from({ length: 101 }, () => ({ text: "" })) }).code, "page_too_large");
});
function documentFixture({ blocked = false, label = "Delivery to Melbourne 3000", scripts = snapshot().scripts } = {}) {
  return { title: "Coles", body: { innerText: "Supreme Pizza" }, querySelectorAll(selector) {
    if (selector === "iframe[src]") return blocked ? [{ getAttribute: () => "/_Incapsula_Resource?test=1" }] : [];
    if (selector.startsWith("header")) return [{ innerText: label }];
    return scripts.map(script => ({ ...script, textContent: script.text }));
  } };
}
test("DOM reader detects HTTP-200 challenge frames", () => {
  assert.equal(read(documentFixture({ blocked: true }), url).code, "retailer_access_restricted");
});
test("DOM reader retains only postcode/mode, never header or account text", () => {
  const result = read(documentFixture({ label: "Delivery to Jane, 12 Example Street, Melbourne 3000" }), url);
  assert.equal(result.location.postcode, "3000"); assert.equal(result.location.verified, false);
  assert.equal(JSON.stringify(result).includes("Jane"), false);
  assert.equal(read(documentFixture({ label: "Sign in" }), url).location, null);
});
test("injected file returns an extraction result to Chrome scripting", () => {
  const isolated = vm.createContext({ URL, Date, document: documentFixture(), location: { href: url } });
  const result = vm.runInContext(source, isolated);
  assert.equal(result.productId, "1435461"); assert.equal(result.price, 7);
});

function worker(existingTask, existingWorkerTabId) {
  const listeners = {};
  const storage = { task: existingTask, workerTabId: existingWorkerTabId };
  const local = {};
  let created = 0;
  const updated = [];
  const panelBehavior = [];
  const chrome = {
    sidePanel: { setPanelBehavior: async options => { panelBehavior.push({ ...options }); } },
    runtime: { id: "test", getURL: path => "chrome-extension://test/" + path, onMessage: { addListener: fn => { listeners.message = fn; } } },
    storage: { session: { get: async () => storage, set: async data => Object.assign(storage, data) },
      local: { get: async () => local, set: async data => Object.assign(local, data), remove: async key => { delete local[key]; }, setAccessLevel: async () => {} } },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener: fn => { listeners.alarm = fn; } } },
    tabs: { create: async () => { created++; return { id: created }; }, get: async () => ({ status: "complete", url }),
      update: async (id, properties) => { updated.push({ id, ...properties }); return { id }; },
      onUpdated: { addListener: fn => { listeners.updated = fn; } }, onRemoved: { addListener: fn => { listeners.removed = fn; } } },
    scripting: { executeScript: async () => [{ result: extract(snapshot()) }] }
  };
  const scope = vm.createContext({ chrome, URL, Date, AbortSignal, crypto: { randomUUID: () => "test-worker" }, importScripts: () => {} });
  vm.runInContext(source, scope); vm.runInContext(background, scope);
  const sender = { id: "test", url: "chrome-extension://test/popup.html" };
  return { storage, local, scope, chrome, listeners, updated, panelBehavior, created: () => created,
    send: message => new Promise(resolve => listeners.message(message, sender, resolve)) };
}
test("toolbar opens the shared side panel without starting a worker task", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.equal(manifest.side_panel.default_path, "popup.html");
  assert.equal(manifest.action.default_popup, undefined);
  const w = worker();
  assert.deepEqual(w.panelBehavior, [{ openPanelOnActionClick: true }]);
  assert.equal(w.created(), 0);
  assert.equal(w.storage.task, undefined);
});

test("background completes an approved panel request and rejects page commands", async () => {
  const w = worker();
  assert.equal(w.listeners.message({ type: "start", url }, { id: "test", url }, () => {}), false);
  assert.equal((await w.send({ type: "start", url })).ok, true);
  assert.equal(w.storage.task.status, "complete"); assert.equal(w.storage.task.result.price, 7);
  assert.equal(w.created(), 1);
});
test("background resumes saved work after service worker suspension", async () => {
  const w = worker({ status: "reading", tabId: 1, productId: "1435461", url, deadline: Date.now() + 60000 });
  await w.send({ type: "status" });
  assert.equal(w.storage.task.result.price, 7); assert.equal(w.created(), 0);
});
test("expired tasks and closed tabs fail without launching another tab", async () => {
  const w = worker({ status: "reading", tabId: 1, productId: "1435461", deadline: 0 });
  await w.send({ type: "status" }); assert.equal(w.storage.task.result.code, "read_timeout");
  const closed = worker({ status: "reading", tabId: 1, productId: "1435461", deadline: Date.now() + 60000 });
  closed.chrome.tabs.get = async () => { throw new Error("closed"); };
  await closed.send({ type: "status" }); assert.equal(closed.storage.task.result.code, "tab_closed");
});
test("concurrent requests cannot create duplicate active jobs", async () => {
  const w = worker(); w.chrome.tabs.get = async () => ({ status: "loading", url });
  const results = await Promise.all([w.send({ type: "start", url }), w.send({ type: "start", url })]);
  assert.equal(results[0].ok, true); assert.equal(results[1].code, "busy"); assert.equal(w.created(), 1);
});
test("redirected tabs and wrong extraction identities are rejected", async () => {
  const w = worker(); w.chrome.tabs.get = async () => ({ status: "complete", url: "https://example.com/" });
  await w.send({ type: "start", url }); assert.equal(w.storage.task.result.code, "product_redirected");
  const other = worker(); other.chrome.scripting.executeScript = async () => [{ result: { ok: true, productId: "999" } }];
  await other.send({ type: "start", url }); assert.equal(other.storage.task.result.code, "product_identity_conflict");
});

test("successive products reuse only the extension-created tab", async () => {
  const w = worker();
  await w.send({ type: "start", url });
  const second = "https://www.coles.com.au/product/coke-1.25l-123011";
  w.chrome.tabs.get = async () => ({ status: "complete", url: second });
  w.chrome.scripting.executeScript = async () => [{ result: { ok: true, productId: "123011" } }];
  await w.send({ type: "start", url: second });
  assert.equal(w.created(), 1);
  assert.deepEqual(w.updated, [{ id: 1, url: second }]);
  assert.equal(w.storage.task.result.productId, "123011");
});
test("saved worker tab is reused after service-worker suspension", async () => {
  const w = worker(undefined, 42);
  await w.send({ type: "start", url });
  assert.equal(w.created(), 0); assert.equal(w.updated[0].id, 42);
});
test("closing worker during a task clears ownership and next request replaces it", async () => {
  const w = worker();
  w.chrome.tabs.get = async () => ({ status: "loading", url });
  await w.send({ type: "start", url });
  w.listeners.removed(1);
  await w.send({ type: "status" }); // Wait behind the removal event in the serial queue.
  assert.equal(w.storage.task.result.code, "tab_closed");
  assert.equal(w.storage.workerTabId, null);
  await w.send({ type: "start", url });
  assert.equal(w.created(), 2); assert.equal(w.storage.workerTabId, 2);
  assert.equal(w.updated.length, 0);
});
test("missing idle worker is replaced even if its removal event was missed", async () => {
  const w = worker(undefined, 42);
  w.chrome.tabs.get = async id => { if (id === 42) throw new Error("closed"); return { status: "complete", url }; };
  await w.send({ type: "start", url });
  assert.equal(w.created(), 1); assert.equal(w.storage.workerTabId, 1);
  assert.equal(w.updated.length, 0);
});
test("unrelated tab closure leaves worker ownership and active task untouched", async () => {
  const w = worker();
  w.chrome.tabs.get = async () => ({ status: "loading", url });
  await w.send({ type: "start", url });
  w.listeners.removed(999);
  await w.send({ type: "status" });
  assert.equal(w.storage.workerTabId, 1); assert.equal(w.storage.task.status, "reading");
  assert.equal(w.updated.length, 0); assert.equal(w.created(), 1);
});
test("failed navigation does not create another tab", async () => {
  const w = worker(undefined, 42);
  w.chrome.tabs.update = async () => { throw new Error("update failed"); };
  assert.equal((await w.send({ type: "start", url })).code, "browser_error");
  assert.equal(w.created(), 0); assert.equal(w.storage.workerTabId, 42);
});
test("pending navigation does not read stale product content", async () => {
  const w = worker(undefined, 42);
  w.chrome.tabs.get = async () => ({ status: "complete", url: "https://www.coles.com.au/product/999", pendingUrl: url });
  w.chrome.scripting.executeScript = async () => { assert.fail("Must wait for navigation"); };
  await w.send({ type: "start", url });
  assert.equal(w.storage.task.status, "reading");
});

test("search reads only bounded product links inside the results container", () => {
  const doc = documentFixture();
  doc.querySelector = selector => selector === '.coles-targeting-search-content-container' ? ({ querySelectorAll: () => [url, url, "https://evil.example/product/123", ...Array.from({ length: 8 }, (_, i) => `/product/${i + 1}`)].map(href => ({ getAttribute: () => href })) }) : null;
  const result = read(doc, "https://www.coles.com.au/search/products?q=pizza");
  assert.equal(result.kind, "search"); assert.equal(result.links.length, 5);
  assert.equal(result.links.filter(link => link === url).length, 1);
  assert.equal(result.links.some(link => link.includes("evil")), false);
  doc.querySelector = () => null;
  assert.equal(read(doc, "https://www.coles.com.au/search/products?q=pizza").code, "product_not_identified");
  doc.body.innerText = "No results for pizza";
  doc.querySelector = selector => selector === 'main h1, h1' ? { textContent: 'No results for pizza' } : null;
  assert.equal(read(doc, "https://www.coles.com.au/search/products?q=pizza").emptyConfirmed, true);
});
test("evidence excludes account state and carries only the matching product", () => {
  const data = snapshot();
  const state = JSON.parse(data.scripts[0].text); state.account = { email: "private@example.test" };
  data.scripts[0].text = JSON.stringify(state);
  const result = read(documentFixture({ scripts: data.scripts }), url);
  assert.equal(JSON.parse(result.evidence.nextProductJson).id, 1435461);
  assert.equal(result.evidence.jsonLd.length, 1);
  assert.equal(JSON.stringify(result.evidence).includes("private@"), false);
});
test("polling receives the entire list but claims one task and reuses the worker tab", async () => {
  const w = worker(undefined, 42);
  w.local.settings = { enabled: true, key: "k".repeat(40), workerId: "worker-test" };
  const tasks = [1, 2].map(id => ({ id, kind: "product", url, status: "Waiting" }));
  const calls = [];
  w.scope.fetch = async (target, options) => {
    calls.push({ target, options });
    assert.equal(options.headers.Authorization, "Bearer " + "k".repeat(40));
    return { ok: true, text: async () => JSON.stringify(target.endsWith("/tasks") ? tasks : { ...tasks[0], claimToken: "claim" }) };
  };
  w.chrome.tabs.get = async () => ({ status: "loading", url });
  await vm.runInContext("tick()", w.scope);
  assert.equal(w.storage.serverTasks.length, 2); assert.equal(w.storage.task.remote.id, 1);
  assert.equal(calls.length, 2); assert.equal(w.updated[0].id, 42); assert.equal(w.created(), 0);
  await vm.runInContext("tick()", w.scope); assert.equal(calls.length, 2);
});
test("unacknowledged result survives network failure and prevents claiming another task", async () => {
  const w = worker({ status: "reading", kind: "product", tabId: 1, productId: "1435461", url,
    deadline: Date.now() + 60000, remote: { id: 1, claimToken: "claim" } });
  w.local.settings = { enabled: true, key: "k".repeat(40), workerId: "worker-test" };
  const calls = [];
  w.scope.fetch = async target => { calls.push(target); throw new Error("offline"); };
  await w.send({ type: "status" });
  assert.equal(w.local.outbox.id, 1);
  await vm.runInContext("tick()", w.scope);
  assert.ok(calls.every(target => target.endsWith("/result")));
  const saved = JSON.stringify(w.local.outbox.submission);
  w.scope.fetch = async (target, options) => {
    assert.ok(target.endsWith("/result")); assert.equal(options.body, saved);
    return { ok: true, text: async () => '{"saved":true}' };
  };
  await vm.runInContext("deliver()", w.scope); assert.equal(w.local.outbox, undefined);
});
test("invalid evidence becomes a failed result and lost leases discard only the old outbox", async () => {
  const w = worker(); w.local.settings = { key: "k".repeat(40) };
  w.local.outbox = { id: 1, submission: { ok: true, evidence: {}, claimToken: "claim" } };
  w.scope.fetch = async () => ({ ok: false, status: 400 });
  assert.equal(await vm.runInContext("deliver()", w.scope), false);
  assert.equal(w.local.outbox.submission.ok, false);
  assert.equal(w.local.outbox.submission.evidence, null);
  w.scope.fetch = async () => ({ ok: false, status: 409 });
  assert.equal(await vm.runInContext("deliver()", w.scope), true);
  assert.equal(w.local.outbox, undefined);
});
test("manual reads are disabled while the server worker runs", async () => {
  const w = worker(); w.local.settings = { enabled: true };
  assert.equal((await w.send({ type: "start", url })).code, "worker_running");
  assert.equal(w.created(), 0);
});

const searchUrl = "https://www.coles.com.au/search/products?q=mccain+superfries+shoestring+900g";
function searchDocument({ fallback = false, extra = false, stale = false } = {}) {
  const doc = documentFixture();
  doc.body.innerText = 'Results for "mccain superfries shoestring 900g" 1 - 2 of 2 results';
  const heading = { textContent: stale ? 'Results for "pizza"' : 'Results for "mccain superfries shoestring 900g"' };
  const container = { querySelectorAll(selector) {
    assert.equal(selector, "a[href]");
    return ["/product/mccain-shoestring-2kg-111", "/product/mccain-shoestring-900g-222", "/product/222?tracking=duplicate",
      ...(extra ? ["/product/recommended-333"] : [])].map(href => ({ getAttribute: () => href, closest: () => null }));
  } };
  doc.querySelector = selector => selector === "main h1, h1" ? heading
    : selector === "main" || selector === ".coles-targeting-search-content-container" && !fallback ? container : null;
  return doc;
}
test("search returns both pack sizes without depending on product link classes", () => {
  for (const fallback of [false, true]) {
    const result = read(searchDocument({ fallback }), searchUrl);
    assert.equal(result.ok, true);
    assert.deepEqual(Array.from(result.links, link => productUrl(link).id), ["111", "222"]);
  }
  assert.equal(read(searchDocument({ stale: true }), searchUrl).code, "product_not_identified");
  assert.equal(read(searchDocument({ fallback: true, extra: true }), searchUrl).code, "product_not_identified");
  const empty = searchDocument(); empty.body.innerText = "No results for mccain superfries shoestring 900g";
  const originalQuery = empty.querySelector;
  empty.querySelector = selector => selector === "main h1, h1" ? { textContent: empty.body.innerText } : originalQuery(selector);
  assert.equal(read(empty, searchUrl).links.length, 2);
  assert.equal(read(empty, searchUrl).emptyConfirmed, false);
});

test("olive oil suggestions survive a no-results heading, but an empty search stays empty", () => {
  const query = "red island extra virgin olive oil cold pressed 1l";
  const requestedUrl = `https://www.coles.com.au/search/products?q=${encodeURIComponent(query)}`;
  for (const fallback of [false, true]) {
    for (const hasProducts of [true, false]) {
      const doc = documentFixture();
      const heading = { textContent: `No results for "${query}"` };
      doc.body.innerText = `${heading.textContent} Here are our best guesses for "${query}"`
        + (hasProducts ? " 1 - 4 of 4 results" : "");
      // Synthetic IDs represent the four pack sizes displayed in the search results.
      const paths = ["250ml-111", "500ml-222", "1l-333", "3l-444"]
        .map(pack => `/product/red-island-extra-virgin-olive-oil-${pack}`);
      const container = { innerText: doc.body.innerText, querySelectorAll: () =>
        (hasProducts ? paths : []).map(href => ({ getAttribute: () => href, closest: () => null })) };
      doc.querySelector = selector => selector === "main h1, h1" ? heading
        : selector === "main" || selector === ".coles-targeting-search-content-container" && !fallback ? container : null;
      const result = read(doc, requestedUrl);
      assert.equal(result.ok, true);
      assert.equal(result.emptyConfirmed, !hasProducts);
      assert.deepEqual(Array.from(result.links), hasProducts ? paths.map(path => `https://www.coles.com.au${path}`) : []);
    }
  }
});

test("Hans single-result search supports the live ID and test ID containers without main", () => {
  const query = "hans twiggy sticks mild 500g";
  const productPath = "/product/hans-twiggy-sticks-mild-500g-2517845";
  for (const containerSelector of ['#coles-targeting-search-content-container', '[data-testid="search-results"]', 'main']) {
    const doc = documentFixture();
    doc.body.innerText = `Results for "${query}" 1 - 1 of 1 result`;
    const container = { querySelectorAll: () => [
      // Coles places the image link inside a product-card header; the title link is outside it.
      { getAttribute: () => productPath, closest: () => ({ tagName: "HEADER" }) },
      { getAttribute: () => productPath, closest: () => null }
    ] };
    doc.querySelector = selector => selector === 'main h1, h1' ? { textContent: `Results for "${query}"` }
      : selector === containerSelector ? container : null;
    const result = read(doc, `https://www.coles.com.au/search/products?q=${encodeURIComponent(query)}`);
    assert.equal(result.ok, true, containerSelector);
    assert.equal(result.emptyConfirmed, false);
    assert.deepEqual(Array.from(result.links), [`https://www.coles.com.au${productPath}`]);
  }
});

test("unrelated empty messages cannot discard real search candidates", () => {
  const doc = searchDocument();
  doc.body.innerText += " Recipes: no results found. Footer: we couldn't find any.";
  const result = read(doc, searchUrl);
  assert.equal(result.links.length, 2); assert.equal(result.emptyConfirmed, false);
  const loading = documentFixture(); loading.body.innerText = "No results found in recipes";
  loading.querySelector = () => null;
  assert.equal(read(loading, searchUrl).code, "product_not_identified");
});

test("popup restores one Start/Stop button and toggles saved worker state", async () => {
  const elements = new Map(); const messages = []; const changes = {};
  const node = () => ({ value: "", textContent: "", dataset: {}, disabled: false, hidden: false,
    events: {}, addEventListener(type, fn) { this.events[type] = fn; }, replaceChildren() {}, append() {} });
  const doc = { getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }, createElement: node };
  const task = { status: "reading", kind: "product", url, remote: { id: 1 } };
  const chrome = {
    runtime: { async sendMessage(message) { messages.push(message); return message.type === "status" ? { ok: true, enabled: true, hasKey: true, task } : { ok: true }; } },
    storage: { session: { get: async () => ({ task, serverTasks: [] }) }, onChanged: { addListener: fn => { changes.listener = fn; } } }
  };
  vm.runInContext(readFileSync(new URL("../popup.js", import.meta.url), "utf8"), vm.createContext({ document: doc, chrome, URL, Intl }));
  await Promise.resolve(); await Promise.resolve();
  const toggle = doc.getElementById("enable");
  assert.equal(toggle.textContent, "Stop worker");
  doc.getElementById("worker-key").value = "unfinished key edit";
  await doc.getElementById("worker-form").events.submit({ preventDefault() {} });
  assert.equal(toggle.textContent, "Start worker");
  assert.equal(messages.at(-1).enabled, false); assert.equal(messages.at(-1).key, "");
  assert.equal(doc.getElementById("read").disabled, true);
  assert.match(doc.getElementById("connection").textContent, /Stopping after the current task/);
  await doc.getElementById("worker-form").events.submit({ preventDefault() {} });
  assert.equal(toggle.textContent, "Stop worker"); assert.equal(messages.at(-1).enabled, true);
  changes.listener({ settings: { newValue: { enabled: false } } }, "local");
  assert.equal(toggle.textContent, "Start worker");
  assert.equal(elements.has("pause"), false);
});
test("search is extracted while background resources load but pending navigation is not read", async () => {
  const task = { status: "reading", kind: "search", tabId: 42, url: searchUrl, deadline: Date.now() + 60000 };
  const w = worker(task, 42);
  w.chrome.tabs.get = async () => ({ status: "loading", url: searchUrl });
  w.chrome.scripting.executeScript = async options => {
    assert.equal(options.injectImmediately, true);
    return [{ result: read(searchDocument(), searchUrl) }];
  };
  await w.send({ type: "status" });
  assert.equal(w.storage.task.status, "complete"); assert.equal(w.storage.task.result.links.length, 2);
  const pending = worker(task, 42);
  pending.chrome.tabs.get = async () => ({ status: "loading", url: searchUrl, pendingUrl: searchUrl });
  pending.chrome.scripting.executeScript = async () => assert.fail("Pending navigation must not be read");
  await pending.send({ type: "status" }); assert.equal(pending.storage.task.status, "reading");
});
test("stale injected search results wait for the requested query", async () => {
  const w = worker({ status: "reading", kind: "search", tabId: 42, url: searchUrl, deadline: Date.now() + 60000 });
  w.chrome.tabs.get = async () => ({ status: "complete", url: searchUrl });
  w.chrome.scripting.executeScript = async () => [{ result: { ok: true, kind: "search", url: "https://www.coles.com.au/search/products?q=pizza", links: [url] } }];
  await w.send({ type: "status" }); assert.equal(w.storage.task.status, "reading");
});
test("search completion continues through both candidate products one by one", async () => {
  const w = worker(undefined, 42);
  w.local.settings = { enabled: true, key: "k".repeat(40), workerId: "worker-test" };
  const search = { id: 1, kind: "search", url: searchUrl, status: "Waiting" };
  let tasks = [search]; let activeUrl = searchUrl; const submitted = []; const claimed = [];
  w.chrome.tabs.update = async (id, properties) => { activeUrl = properties.url; w.updated.push({ id, ...properties }); return { id }; };
  w.chrome.tabs.get = async () => ({ status: activeUrl === searchUrl ? "loading" : "complete", url: activeUrl });
  w.chrome.scripting.executeScript = async () => [{ result: activeUrl === searchUrl ? read(searchDocument(), searchUrl)
    : { ok: true, productId: productUrl(activeUrl).id, evidence: { nextProductJson: null, jsonLd: [] } } }];
  w.scope.fetch = async (target, options) => {
    let response;
    if (target.endsWith("/tasks")) response = tasks;
    else if (target.endsWith("/claim")) {
      const id = Number(target.split("/").at(-2)); claimed.push(id);
      response = { ...tasks.find(t => t.id === id), claimToken: "claim-" + id };
    } else {
      const id = Number(target.split("/").at(-2)); const submission = JSON.parse(options.body);
      submitted.push(id); tasks = tasks.filter(t => t.id !== id);
      if (id === 1) tasks = submission.links.map((link, i) => ({ id: i + 2, kind: "product", url: link, status: "Waiting" }));
      response = { saved: true };
    }
    return { ok: true, text: async () => JSON.stringify(response) };
  };
  await vm.runInContext("serial(tick)", w.scope);
  for (let i = 0; i < 6; i++) await w.send({ type: "status" });
  assert.deepEqual(claimed, [1, 2, 3]); assert.deepEqual(submitted, [1, 2, 3]);
  assert.equal(w.created(), 0); assert.equal(w.updated.length, 3);
  assert.ok(w.updated.every(tab => tab.id === 42)); assert.equal(w.local.outbox, undefined);
});
