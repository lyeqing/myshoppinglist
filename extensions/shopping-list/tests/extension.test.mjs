import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
const { productUrl, createWorker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const token = "a".repeat(64);
function fixture(lists = [{ id: 1, name: "One" }]) {
  let data = { token };
  const calls = [];
  const browser = { runtime: { id: "a".repeat(32) }, storage: { session: {
    get: async () => ({ ...data }), set: async value => { Object.assign(data, value); }, clear: async () => { data = {}; },
  } } };
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    const value = url.endsWith("user-extension/login") ? { token, session: { account: { id: 1 } } }
      : url.endsWith("/me") ? { account: { id: 1 } }
      : url.endsWith("/shopping-lists") ? lists
      : url.endsWith("/default") ? { shoppingListId: 3 }
      : { jobId: 10, quantity: 2, reused: false };
    return { ok: true, status: 200, json: async () => value };
  };
  return { handle: createWorker(browser, fetcher), browser, calls, data: () => data };
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
  const result = await f.handle({ type: "add", url, quantity: 2, listId: 2 });
  assert.equal(result.result.jobId, 10);
  const call = f.calls.at(-1);
  assert.match(call.url, /shopping-lists\/2\/products\/url$/);
  assert.equal(call.credentials, "omit"); assert.equal(call.headers.Authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(call.body), { url, quantity: 2 });
});
test("creates default only with no lists, and rejects unowned or missing selection", async () => {
  const empty = fixture([]); await empty.handle({ type: "add", url, quantity: 2, listId: null });
  assert.equal(empty.calls.filter(c => c.url.endsWith("/default")).length, 1);
  assert.match(empty.calls.at(-1).url, /shopping-lists\/3\/products\/url$/);
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
