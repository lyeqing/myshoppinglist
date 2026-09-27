/* global chrome, importScripts */
importScripts("content.js");
const READER = globalThis.ColesReader;
const ALARM = "coles-read-deadline";
const POLL = "coles-server-poll";
const API = "http://localhost:5392/api/coles-worker";
let queue = Promise.resolve();
const serial = (work) => {
  const next = queue.then(work);
  queue = next.catch(() => {});
  return next;
};
const failure = (code, message) => ({ ok: false, code, message });
async function current() { return (await chrome.storage.session.get("task")).task; }
async function workerTab(url) {
  const { workerTabId } = await chrome.storage.session.get("workerTabId");
  if (Number.isInteger(workerTabId)) {
    let existing;
    try { existing = await chrome.tabs.get(workerTabId); } catch { /* Closed while idle. */ }
    if (existing) {
      // Only the ID we created is eligible. Never search for other Coles/user tabs.
      // An update failure must not create a second tab while this one still exists.
      return chrome.tabs.update(workerTabId, { url });
    }
    await chrome.storage.session.set({ workerTabId: null });
  }
  const tab = await chrome.tabs.create({ url, active: false });
  await chrome.storage.session.set({ workerTabId: tab.id });
  return tab;
}
async function finish(task, result) {
  if (task.remote) {
    const config = await settings();
    const submission = { workerId: config.workerId, claimToken: task.remote.claimToken,
      url: task.url, ok: result.ok, evidence: result.evidence || null, links: result.links || null,
      emptyConfirmed: !!result.emptyConfirmed, errorCode: result.ok ? null : result.code };
    await chrome.storage.local.set({ outbox: { id: task.remote.id, submission } });
    await chrome.storage.session.set({ task: { ...task, status: "complete", result } });
    await chrome.alarms.clear(ALARM);
    await deliver();
    void serial(tick);
  } else {
    await chrome.storage.session.set({ task: { ...task, status: "complete", result } });
    await chrome.alarms.clear(ALARM);
  }
}
async function inspect() {
  const task = await current();
  if (!task || task.status !== "reading") return;
  if (Date.now() >= task.deadline) {
    await finish(task, failure("read_timeout", "Timed out after 90 seconds. Inspect the Coles tab, then try again."));
    return;
  }
  let tab;
  try { tab = await chrome.tabs.get(task.tabId); }
  catch { await finish(task, failure("tab_closed", "The product tab was closed.")); return; }
  if (tab.pendingUrl || (task.kind !== "search" && tab.status !== "complete")) return;
  if (task.kind === "search" && tab.status === "loading" && tab.url !== task.url) return;
  if (task.kind === "search" ? tab.url !== task.url : READER.productUrl(tab.url)?.id !== task.productId) {
    await finish(task, failure("product_redirected", "The tab navigated away from the requested product."));
    return;
  }
  try {
    const responses = await chrome.scripting.executeScript({ target: { tabId: task.tabId, frameIds: [0] },
      files: ["content.js"], world: "ISOLATED", injectImmediately: task.kind === "search" });
    const result = responses[0]?.result;
    if (!result || result.code === "product_not_identified") return;
    if (task.kind === "search" && result.ok && (result.kind !== "search" || result.url !== task.url)) return;
    if (result.ok && task.kind !== "search" && result.productId !== task.productId) {
      await finish(task, failure("product_identity_conflict", "The extracted product does not match the request."));
    } else await finish(task, result);
  } catch {
    // A navigation can race injection. Retry on the next completion event/alarm.
    await chrome.storage.session.set({ task: { ...task, note: "Waiting for page access. Check that the extension is allowed on Coles." } });
  }
}
async function start(url, remote = null) {
  const isSearch = remote?.kind === "search" && validSearchUrl(url);
  const product = isSearch ? { id: null, url } : READER.productUrl(url);
  if (!product) return failure("invalid_url", "Paste an HTTPS Coles product URL.");
  await inspect();
  if ((await current())?.status === "reading") return failure("busy", "A product is already being read. Wait for it to finish.");
  const task = { status: "reading", kind: isSearch ? "search" : "product", remote,
    productId: product.id, url: product.url, startedAt: Date.now(), deadline: Date.now() + 90000 };
  // Persist before navigation; subsequent Chrome events can resume after worker suspension.
  await chrome.storage.session.set({ task });
  try {
    const tab = await workerTab(product.url);
    task.tabId = tab.id;
    await chrome.storage.session.set({ task });
    await chrome.alarms.create(ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    await inspect();
    return { ok: true };
  } catch {
    const result = failure("browser_error", "Chrome could not start the product read.");
    await finish(task, result);
    return result;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Accept commands only from this extension's popup, never a retailer tab.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
  serial(async () => {
    if (message?.type === "configure") return configure(message);
    if (message?.type === "retry" && Number.isSafeInteger(message.id)) {
      await server("/tasks/" + message.id + "/retry", {}); void serial(tick); return { ok: true };
    }
    if (message?.type === "start") {
      if ((await settings()).enabled) return failure("worker_running", "Pause the server worker before starting a manual read.");
      return start(message.url);
    }
    if (message?.type === "status") {
      await inspect(); const config = await settings();
      return { ok: true, task: await current(), enabled: config.enabled, hasKey: !!config.key };
    }
    return failure("invalid_command", "Unknown command.");
  }).then(respond, () => respond(failure("browser_error", "Chrome could not complete this action.")));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "complete") void serial(async () => { if ((await current())?.tabId === tabId) await inspect(); });
});
chrome.tabs.onRemoved.addListener(tabId => {
  void serial(async () => {
    const { workerTabId } = await chrome.storage.session.get("workerTabId");
    if (workerTabId === tabId) await chrome.storage.session.set({ workerTabId: null });
    const task = await current();
    if (task?.tabId === tabId && task.status === "reading") await finish(task, failure("tab_closed", "The product tab was closed."));
  });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) void serial(inspect);
  if (alarm.name === POLL) void serial(tick);
});

function validSearchUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://www.coles.com.au" && !url.username && !url.password
      && url.pathname === "/search/products" && url.searchParams.has("q") && value.length <= 2048;
  } catch { return false; }
}
async function settings() { return (await chrome.storage.local.get("settings")).settings || { enabled: false }; }
async function server(path, body) {
  const config = await settings();
  const response = await fetch(API + path, { method: body === undefined ? "GET" : "POST", credentials: "omit",
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12000),
    headers: { Authorization: "Bearer " + config.key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const error = new Error(response.status === 401 ? "Worker key rejected. Check the server key." : "Server returned " + response.status);
    error.status = response.status; throw error;
  }
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
async function deliver() {
  const { outbox } = await chrome.storage.local.get("outbox");
  if (!outbox) return true;
  try {
    await server("/tasks/" + outbox.id + "/result", outbox.submission);
    await chrome.storage.local.remove("outbox");
    await chrome.storage.session.set({ connection: "Result saved by server." });
    return true;
  } catch (error) {
    if (error.status === 409) {
      // The old lease is no longer authoritative. The server will reassign the task.
      await chrome.storage.local.remove("outbox");
      await chrome.storage.session.set({ connection: "Assignment expired; waiting for the server to reassign it." });
      return true;
    }
    if (error.status === 400 && outbox.submission.ok) {
      // Report rejected evidence as a failure; never keep resending invalid data forever.
      await chrome.storage.local.set({ outbox: { id: outbox.id,
        submission: { ...outbox.submission, ok: false, evidence: null, links: null, errorCode: "invalid_product_evidence" } } });
    }
    await chrome.storage.session.set({ connection: error.message || "Server unavailable; result kept for retry." });
    return false;
  }
}
async function tick() {
  try {
    const config = await settings();
    if (!config.enabled) return;
    if (!await deliver()) return;
    await inspect();
    if ((await current())?.status === "reading") return;
    if ((await chrome.storage.local.get("outbox")).outbox) return;
    const tasks = await server("/tasks");
    if (!Array.isArray(tasks)) throw new Error("Invalid server queue response.");
    await chrome.storage.session.set({ serverTasks: tasks, connection: "Connected · " + tasks.filter(t => t.status === "Waiting").length + " waiting" });
    // Keep the entire list, but claim only the next item: later entries cannot expire while waiting.
    for (const task of tasks.filter(t => t.status === "Waiting")) {
      if (!Number.isSafeInteger(task.id) || task.id < 1) continue;
      if (task.kind === "product" ? !READER.productUrl(task.url) : task.kind !== "search" || !validSearchUrl(task.url)) continue;
      let claim;
      try { claim = await server("/tasks/" + task.id + "/claim", { workerId: config.workerId }); }
      catch (error) { if (error.status === 409) continue; throw error; }
      if (claim?.id !== task.id || claim.url !== task.url || claim.kind !== task.kind || typeof claim.claimToken !== "string")
        throw new Error("Invalid task assignment.");
      await start(claim.url, claim); return;
    }
  } catch (error) {
    await chrome.storage.session.set({ connection: error.message || "Server unavailable; polling will retry." });
  }
}
async function configure(message) {
  const old = await settings();
  const key = typeof message.key === "string" && message.key.trim() ? message.key.trim() : old.key;
  if (message.enabled && (!key || key.length < 32 || key.length > 512)) return failure("invalid_key", "Enter the server's worker key (at least 32 characters).");
  if (key !== old.key && (await chrome.storage.local.get("outbox")).outbox)
    return failure("pending_result", "Finish submitting the pending result before changing the key.");
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.local.set({ settings: { enabled: !!message.enabled, key, workerId: old.workerId || crypto.randomUUID() } });
  if (message.enabled) {
    await chrome.alarms.create(POLL, { periodInMinutes: 0.5 });
    void serial(tick);
  } else await chrome.alarms.clear(POLL);
  return { ok: true };
}
chrome.runtime.onStartup?.addListener(() => {
  void serial(async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    if ((await settings()).enabled) { await chrome.alarms.create(POLL, { periodInMinutes: 0.5 }); await tick(); }
  });
});
chrome.runtime.onInstalled?.addListener(() => {
  void serial(async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    if ((await settings()).enabled) { await chrome.alarms.create(POLL, { periodInMinutes: 0.5 }); await tick(); }
  });
});
