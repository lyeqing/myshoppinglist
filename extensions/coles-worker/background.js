/* global chrome, importScripts */
importScripts("content.js");
const READER = globalThis.ColesReader;
const ALARM = "coles-read-deadline";
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
  await chrome.storage.session.set({ task: { ...task, status: "complete", result } });
  await chrome.alarms.clear(ALARM);
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
  if (tab.status !== "complete" || tab.pendingUrl) return;
  if (READER.productUrl(tab.url)?.id !== task.productId) {
    await finish(task, failure("product_redirected", "The tab navigated away from the requested product."));
    return;
  }
  try {
    const responses = await chrome.scripting.executeScript({ target: { tabId: task.tabId, frameIds: [0] }, files: ["content.js"], world: "ISOLATED" });
    const result = responses[0]?.result;
    if (!result || result.code === "product_not_identified") return;
    if (result.ok && result.productId !== task.productId) {
      await finish(task, failure("product_identity_conflict", "The extracted product does not match the request."));
    } else await finish(task, result);
  } catch {
    // A navigation can race injection. Retry on the next completion event/alarm.
    await chrome.storage.session.set({ task: { ...task, note: "Waiting for page access. Check that the extension is allowed on Coles." } });
  }
}
async function start(url) {
  const product = READER.productUrl(url);
  if (!product) return failure("invalid_url", "Paste an HTTPS Coles product URL.");
  await inspect();
  if ((await current())?.status === "reading") return failure("busy", "A product is already being read. Wait for it to finish.");
  const task = { status: "reading", productId: product.id, url: product.url, startedAt: Date.now(), deadline: Date.now() + 90000 };
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
    if (message?.type === "start") return start(message.url);
    if (message?.type === "status") { await inspect(); return { ok: true, task: await current() }; }
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
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void serial(inspect); });
