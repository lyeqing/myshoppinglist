import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const bridgeModule = `data:text/javascript;base64,${Buffer.from(await readFile(new URL("../ai-bridge.js", import.meta.url), "utf8")).toString("base64")}`;
const load = async path => import(`data:text/javascript;base64,${Buffer.from((await readFile(new URL(path, import.meta.url), "utf8")).replace('"./ai-bridge.js"', JSON.stringify(bridgeModule))).toString("base64")}`);
const { createExtensionBridge } = await load("../ai-bridge.js");
const { productUrl, sameProductUrl } = await load("../background.js");
function fixture(type = "capture") {
  const token = "a".repeat(64), id = "12345678-1234-1234-1234-123456789012";
  let owner = token, permitted = true, badUrl = false, switchOnRead = false, uncertain = false, blocked = false;
  const task = { id, type, status: "awaiting_user", retailer: "coles", url: type === "capture"
    ? "https://www.coles.com.au/product/123456" : "https://www.coles.com.au/search/products?q=rice" };
  const data = { aiDevice: { deviceId: "device", deviceToken: "b".repeat(64), forToken: token } };
  const requests = [], opened = [], scripts = [], bodies = [];
  const store = { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])),
    set: async values => Object.assign(data, structuredClone(values)), remove: async keys => { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; } };
  const browser = { storage: { session: store, local: store }, runtime: { id: "a".repeat(32), getManifest: () => ({ version: "0.9.0" }) },
    permissions: { contains: async () => permitted },
    tabs: { create: async value => { opened.push(value); return { id: 91 }; },
      get: async () => ({ url: badUrl ? "https://evil.test/" : task.url, active: true, status: "complete" }),
      update: async id => { assert.equal(id, 42); } },
    scripting: { executeScript: async options => { scripts.push(options); if (switchOnRead) owner = "c".repeat(64);
      return options.files ? [] : [{ result: blocked ? { ok: false, code: "retailer_access_restricted" } : type === "capture" ? { ok: true, evidence: { jsonLd: ["bounded product evidence"] } }
        : { ok: true, kind: "search", links: ["https://www.coles.com.au/product/123456"], emptyConfirmed: false } }]; } } };
  const worker = { syncSession: async () => owner, request: async path => path.endsWith("bridge-info")
    ? { enabled: true } : { account: { id: 1, isTrial: false, displayName: "Owner" } } };
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname; const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path, body, headers: options.headers });
    assert.equal(options.credentials, "omit");
    let result;
    if (path.endsWith("/heartbeat")) return new Response(null, { status: 204 });
    if (path.endsWith("/tasks")) result = [task];
    else if (path.endsWith("/decision")) { task.status = body.approve ? "acknowledged" : "cancelled"; result = { task, claimToken: body.approve ? "proof" : null }; }
    else if (path.endsWith("/start")) { task.status = "running"; result = task; }
    else if (path.endsWith("/preview")) result = { name: "Rice", price: null };
    else if (path.endsWith("/capture") || path.endsWith("/search")) {
      bodies.push(body); task.status = "completed";
      if (uncertain) { uncertain = false; throw new TypeError("Connection lost after commit"); }
      result = task;
    } else if (path.endsWith("/fail")) { task.status = "failed"; task.errorCode = body.errorCode; result = task; }
    else if (path.endsWith("/cancel")) { task.status = "cancelled"; result = task; }
    else result = task;
    return Response.json(result);
  };
  const make = () => createExtensionBridge(browser, worker, { apiUrl: "http://localhost:5392", productUrl, sameProductUrl, fetcher, pause: async () => {} });
  return { handle: make(), make, task, data, requests, opened, scripts, bodies,
    denyPermission: () => { permitted = false; }, redirect: () => { badUrl = true; },
    switchOnRead: () => { switchOnRead = true; }, uncertain: () => { uncertain = true; }, block: () => { blocked = true; } };
}
test("poll and decline never open a tab or read page contents; snapshots contain no device secrets", async () => {
  const f = fixture();
  const state = await f.handle({ type: "ai-state" }, 42);
  assert.equal(state.linked, true); assert.equal(JSON.stringify(state).includes("bbbbbbbb"), false);
  await f.handle({ type: "ai-decline", taskId: f.task.id }, 42);
  assert.equal(f.opened.length, 0); assert.equal(f.scripts.length, 0); assert.equal(f.bodies.length, 0);
});
test("approval starts one supported tab, reviews without saving, then explicitly saves exact evidence", async () => {
  const f = fixture(); const state = await f.handle({ type: "ai-approve", taskId: f.task.id }, 42);
  assert.equal(f.opened.length, 1); assert.equal(state.active.review.name, "Rice"); assert.equal(f.bodies.length, 0);
  assert.equal(JSON.stringify(state).includes("bounded product evidence"), false);
  assert.equal(JSON.stringify(state).includes("proof"), false);
  const saved = await f.handle({ type: "ai-save" }, 42);
  assert.equal(saved.outcome.status, "completed"); assert.equal(f.bodies.length, 1); assert.equal(f.data.aiActive, null);
});
test("uncertain save survives worker restart and reuses identical evidence", async () => {
  const f = fixture(); await f.handle({ type: "ai-approve", taskId: f.task.id }, 42); f.uncertain();
  await assert.rejects(f.handle({ type: "ai-save" }, 42), /Connection lost/);
  assert.ok(f.data.aiActive.body);
  await f.make()({ type: "ai-save" }, 42);
  assert.deepEqual(f.bodies[0], f.bodies[1]); assert.equal(f.opened.length, 1);
});
test("permission loss, navigation and account change stop reading or saving", async () => {
  const permission = fixture(); permission.denyPermission();
  await assert.rejects(permission.handle({ type: "ai-approve", taskId: permission.task.id }, 42), /Allow this retailer/);
  assert.equal(permission.opened.length, 0);
  const navigation = fixture(); navigation.redirect();
  await assert.rejects(navigation.handle({ type: "ai-approve", taskId: navigation.task.id }, 42), /page changed/);
  assert.equal(navigation.scripts.length, 0);
  const account = fixture(); account.switchOnRead();
  await assert.rejects(account.handle({ type: "ai-approve", taskId: account.task.id }, 42), /account changed/);
  assert.equal(account.bodies.length, 0); assert.equal(account.data.aiActive.body, undefined);
});
test("bounded search shares only explicitly reviewed candidate links with unknown names", async () => {
  const f = fixture("search"); const state = await f.handle({ type: "ai-approve", taskId: f.task.id }, 42);
  assert.deepEqual(state.active.review.candidates, [{ url: "https://www.coles.com.au/product/123456", name: null }]);
  assert.equal(f.bodies.length, 0);
  await f.handle({ type: "ai-save" }, 42); assert.equal(f.bodies[0].candidates.length, 1);
  assert.equal(f.requests.some(r => r.path.endsWith("/capture")), false);
});
test("cancel after review saves neither product nor candidate links", async () => {
  const f = fixture(); await f.handle({ type: "ai-approve", taskId: f.task.id }, 42);
  const state = await f.handle({ type: "ai-cancel" }, 42);
  assert.equal(state.outcome.status, "cancelled"); assert.equal(f.bodies.length, 0);
});
test("retailer access restrictions end the task without retrying or saving", async () => {
  const f = fixture(); f.block();
  await assert.rejects(f.handle({ type: "ai-approve", taskId: f.task.id }, 42), /retailer restricted/);
  assert.equal(f.data.aiOutcome.status, "failed"); assert.equal(f.data.aiOutcome.errorCode, "retailer_blocked");
  assert.equal(f.data.aiActive, null); assert.equal(f.bodies.length, 0); assert.equal(f.scripts.length, 2);
});
