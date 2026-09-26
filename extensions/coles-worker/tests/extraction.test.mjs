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
  let created = 0;
  const updated = [];
  const chrome = {
    runtime: { id: "test", getURL: path => "chrome-extension://test/" + path, onMessage: { addListener: fn => { listeners.message = fn; } } },
    storage: { session: { get: async () => storage, set: async data => Object.assign(storage, data) } },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener: fn => { listeners.alarm = fn; } } },
    tabs: { create: async () => { created++; return { id: created }; }, get: async () => ({ status: "complete", url }),
      update: async (id, properties) => { updated.push({ id, ...properties }); return { id }; },
      onUpdated: { addListener: fn => { listeners.updated = fn; } }, onRemoved: { addListener: fn => { listeners.removed = fn; } } },
    scripting: { executeScript: async () => [{ result: extract(snapshot()) }] }
  };
  const scope = vm.createContext({ chrome, URL, Date, importScripts: () => {} });
  vm.runInContext(source, scope); vm.runInContext(background, scope);
  const sender = { id: "test", url: "chrome-extension://test/popup.html" };
  return { storage, chrome, listeners, updated, created: () => created,
    send: message => new Promise(resolve => listeners.message(message, sender, resolve)) };
}
test("background completes an approved popup request and rejects page commands", async () => {
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
