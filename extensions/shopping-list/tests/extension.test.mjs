import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
const { productUrl, createWorker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const token = "a".repeat(64);
function fixture(lists = [{ id: 1, name: "One" }]) {
  let data = { token };
  const calls = [];
  const removed = [];
  const tabs = new Map([[7, { id: 7, url: "https://www.coles.com.au/product/test-123" }]]);
  const browser = { runtime: { id: "a".repeat(32) },
    alarms: { create: async () => {}, clear: async () => {} },
    tabs: { get: async id => { if (!tabs.has(id)) throw new Error("closed"); return tabs.get(id); },
      create: async ({ url }) => { const tab = { id: 100, url }; tabs.set(100, tab); return tab; },
      update: async (id, value) => { Object.assign(tabs.get(id), value); }, remove: async id => { removed.push(id); tabs.delete(id); } },
    scripting: { executeScript: async () => [{ result: { ok: true, evidence: { nextProductJson: "{}", jsonLd: [] } } }] },
    storage: { session: {
    get: async () => structuredClone(data), set: async value => { Object.assign(data, structuredClone(value)); }, remove: async key => { delete data[key]; }, clear: async () => { data = {}; },
  } } };
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    const value = url.endsWith("user-extension/login") ? { token, session: { account: { id: 1 } } }
      : url.endsWith("/me") ? { account: { id: 1 } }
      : url.endsWith("/shopping-lists") ? lists
      : url.endsWith("/default") ? { shoppingListId: 3 }
      : { jobId: 10, status: "Completed", sourceSaved: true, stage: "complete" };
    return { ok: true, status: 200, json: async () => value };
  };
  return { handle: createWorker(browser, fetcher), fetcher, browser, calls, removed, data: () => data };
}
const url = "https://www.coles.com.au/product/test-123";
test("valid product URLs canonicalize; unrelated and misleading hosts fail", () => {
  assert.equal(productUrl(url + "?pid=tracking#fragment"), url);
  assert.ok(productUrl("https://www.coles.com.au/product/four'n-twenty-123"));
  assert.ok(productUrl("https://www.woolworths.com.au/shop/productdetails/123/name"));
  for (const value of ["https://evil.com/product/test-123", "https://coles.com.au.evil.com/product/test-123", "http://coles.com.au/product/test-123", "https://www.coles.com.au/search/products?q=test", "https://x@www.coles.com.au/product/test-123", "chrome://extensions"]) assert.equal(productUrl(value), null);
});
test("adds to chosen owned list with bearer token, without cookies", async () => {
  const f = fixture([{ id: 1 }, { id: 2 }]);
  await f.handle({ type: "add", url, tabId: 7, quantity: 2, listId: 2 });
  await f.handle.pump();
  assert.equal(f.data().workflow.work.jobId, 10);
  const call = f.calls.at(-1);
  assert.match(call.url, /user-extension\/imports\/$/);
  assert.equal(call.credentials, "omit"); assert.equal(call.headers.Authorization, `Bearer ${token}`);
  assert.equal(JSON.parse(call.body).listId, 2);
  assert.equal(JSON.parse(call.body).url, url);
  assert.equal(JSON.parse(call.body).quantity, 2);
  assert.ok(JSON.parse(call.body).evidence);
  assert.deepEqual(f.removed, []);
});
test("creates default only with no lists, and rejects unowned or missing selection", async () => {
  const empty = fixture([]); await empty.handle({ type: "add", url, tabId: 7, quantity: 2, listId: null });
  await empty.handle.pump();
  assert.equal(empty.calls.filter(c => c.url.endsWith("/default")).length, 1);
  assert.equal(JSON.parse(empty.calls.at(-1).body).listId, 3);
  const multi = fixture([{ id: 1 }, { id: 2 }]);
  await assert.rejects(multi.handle({ type: "add", url, quantity: 2, listId: 99 }), /Choose/);
  await assert.rejects(multi.handle({ type: "add", url, quantity: 2, listId: null }), /Choose/);
  assert.equal(multi.calls.filter(c => c.method === "POST").length, 0);
});
test("login stores only token, state never returns token and logout clears it", async () => {
  const f = fixture(); await f.browser.storage.session.clear();
  await f.handle({ type: "login", email: "a@example.test", password: "secret" });
  assert.deepEqual(f.data(), { token });
  assert.equal(f.calls[0].headers.Authorization, undefined);
  assert.equal((await f.handle({ type: "state" })).token, undefined);
  await f.handle({ type: "logout" }); assert.deepEqual(f.data(), {});
});
test("unauthorized API clears token and invalid quantities cannot submit", async () => {
  const f = fixture();
  await assert.rejects(f.handle({ type: "add", url, quantity: 0 }), /positive/);
  const handle = createWorker(f.browser, async () => ({ status: 401, ok: false, json: async () => ({}) }));
  await assert.rejects(handle({ type: "state" }), /sign in/);
  assert.deepEqual(f.data(), {});
});

test("comparison uses one owned tab, resumes its own work, closes it and never polls unrelated tasks", async () => {
  const f = fixture();
  const searchUrl = "https://www.woolworths.com.au/shop/search/products?searchTerm=test";
  const candidate = "https://www.woolworths.com.au/shop/productdetails/123";
  let results = 0;
  const response = data => ({ ok: true, status: 200, json: async () => data });
  const fetcher = async (address, options) => {
    if (address.endsWith("/imports/")) return response({ jobId: 20, status: "Waiting", sourceSaved: true, stage: "search", stepToken: "search", url: searchUrl });
    if (address.endsWith("/result")) {
      results++;
      assert.equal(JSON.parse(options.body).stepToken, results === 1 ? "search" : "product");
      return response(results === 1 ? { jobId: 20, status: "Waiting", sourceSaved: true, stage: "product", stepToken: "product", url: candidate }
        : { jobId: 20, status: "Completed", sourceSaved: true, stage: "complete" });
    }
    return f.fetcher(address, options);
  };
  f.browser.scripting.executeScript = async ({ target }) => [{ result: target.tabId === 7 ? { ok: true, evidence: {} }
    : results === 0 ? { ok: true, kind: "search", url: searchUrl, links: [candidate] } : { ok: true, evidence: {} } }];
  const handle = createWorker(f.browser, fetcher);
  await handle({ type: "add", url, tabId: 7, quantity: 2, listId: 1 });
  await handle.pump();
  assert.equal(f.data().workflow.temporaryTabId, 100);
  await handle.pump(); await handle.pump();
  assert.equal(f.data().workflow.status, "Completed");
  assert.deepEqual(f.removed, [100]);
  assert.equal((await f.browser.tabs.get(7)).url, url);
  const before = f.calls.length; await handle.pump(); assert.equal(f.calls.length, before);
  assert.equal(results, 2);
  assert.ok(f.calls.every(c => !c.url.includes("coles-worker")));
});

test("lost response keeps identical outbox and request ID for retry", async () => {
  const f = fixture(); let first = true; const bodies = [];
  const handle = createWorker(f.browser, async (address, options) => {
    if (address.endsWith("/imports/")) {
      bodies.push(options.body);
      if (first) { first = false; throw new TypeError("Connection lost"); }
    }
    return f.fetcher(address, options);
  });
  await handle({ type: "add", url, tabId: 7, quantity: 2, listId: 1 });
  await handle.pump(); assert.equal(f.data().workflow.status, "Failed");
  await handle({ type: "retry" }); await handle.pump();
  assert.equal(f.data().workflow.status, "Completed"); assert.equal(bodies[0], bodies[1]);
});

test("comparison read failure closes only the temporary tab", async () => {
  const f = fixture();
  const handle = createWorker(f.browser, async (address, options) => {
    if (address.endsWith("/imports/")) return { ok: true, status: 200, json: async () => ({ jobId: 5, status: "Waiting", stage: "product", stepToken: "p", url: "https://www.woolworths.com.au/shop/productdetails/123" }) };
    if (address.endsWith("/result")) { assert.equal(JSON.parse(options.body).ok, false); return { ok: true, status: 200, json: async () => ({ jobId: 5, status: "Failed", sourceSaved: true, errorCode: "read_failed" }) }; }
    return f.fetcher(address, options);
  });
  await handle({ type: "add", url, tabId: 7, quantity: 2, listId: 1 }); await handle.pump();
  f.browser.scripting.executeScript = async () => [{ result: { ok: false, code: "access_restricted" } }];
  await handle.pump(); assert.deepEqual(f.removed, [100]); assert.equal(f.data().workflow.status, "Failed");
});
