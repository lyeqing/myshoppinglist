import { productUrl } from "./background.js";
const el = id => document.getElementById(id);
let url = null;
let busy = false;
let signedIn = false;
let tabId;
let activeImport = false;
el("extension-id").textContent = chrome.runtime.id;
function status(text, error = false) { el("status").textContent = text; el("status").className = error ? "error" : ""; }
function disabled(value) { busy = value; document.querySelectorAll("button,input,select").forEach(e => { e.disabled = value; }); el("add-button").disabled = value || activeImport || !url || !signedIn; }
function progress(workflow) {
  activeImport = workflow?.status === "Reading";
  el("retry").hidden = workflow?.status !== "Failed";
  if (workflow) status(workflow.message, workflow.status === "Failed");
  disabled(busy);
}
async function send(message) { const result = await chrome.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.error || "The extension could not complete the request."); return result.data; }
function render(data) {
  signedIn = !!data.session;
  el("help-prices").checked = data.preference?.enabled !== false;
  el("shared-status").textContent = data.preference?.blocked ? "Shared collection is restricted for this account. You can still add products." : data.preference?.enabled ? "Ready to help while idle." : "Shared collection is off.";
  el("login").hidden = signedIn; el("account").hidden = !signedIn;
  el("name").textContent = data.session?.account.displayName || "";
  el("list").replaceChildren();
  const lists = data.lists || [];
  if (lists.length > 1) { const option = document.createElement("option"); option.value = ""; option.textContent = "Choose a list"; el("list").append(option); }
  for (const list of lists) { const option = document.createElement("option"); option.value = String(list.id); option.textContent = list.name; el("list").append(option); }
  el("list-label").hidden = !lists.length; el("list").required = lists.length > 1;
  el("empty").hidden = !!lists.length;
  if (data.result?.url === url) confirmation(data.result);
  progress(data.workflow);
}
function confirmation(result) { status(result.reused ? "This product is already being checked. Its original quantity is unchanged." : `Added to the import queue (quantity ${result.quantity}). Price checks are in progress. Open MyShoppingList to follow progress.`); }
async function refresh() {
  if (busy) return;
  disabled(true); status("");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    url = productUrl(tab?.url);
    el("product").textContent = url || "Open a Coles or Woolworths product page to add it.";
    render(await send({ type: "state" }));
  } catch (error) { render({ session: null }); status(error.message, true); }
  finally { disabled(false); }
}
el("login").addEventListener("submit", async event => {
  event.preventDefault(); if (busy) return; disabled(true); status("Signing in…");
  try { render(await send({ type: "login", email: el("email").value.trim(), password: el("password").value })); status("Signed in. Choose your list and add the product."); }
  catch (error) { status(error.message, true); }
  finally { el("password").value = ""; disabled(false); }
});
el("add").addEventListener("submit", async event => {
  event.preventDefault(); if (busy) return; disabled(true); status("Adding product…");
  try { const data = await send({ type: "add", url, tabId, listId: el("list").value ? Number(el("list").value) : null, quantity: Number(el("quantity").value) }); progress(data.workflow); }
  catch (error) { status(error.message, true); }
  finally { disabled(false); }
});
el("logout").addEventListener("click", async () => {
  if (busy) return; disabled(true);
  try { await send({ type: "logout" }); status("Signed out."); }
  catch (error) { status(`${error.message} Local sign-in was cleared.`, true); }
  finally { render({ session: null }); disabled(false); }
});
el("refresh").addEventListener("click", refresh);
el("retry").addEventListener("click", async () => {
  if (busy) return; disabled(true);
  try { progress((await send({ type: "retry" })).workflow); }
  catch (error) { status(error.message, true); }
  finally { disabled(false); }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.workflow) progress(changes.workflow.newValue); });
void refresh();
let sessionRefreshTimer;
function refreshSharedSession() {
  clearTimeout(sessionRefreshTimer);
  if (busy) { sessionRefreshTimer = setTimeout(refreshSharedSession, 150); return; }
  void refresh();
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes.token) return;
  if (!changes.token.newValue) render({ session: null });
  clearTimeout(sessionRefreshTimer); sessionRefreshTimer = setTimeout(refreshSharedSession, 100);
});
el("help-prices").addEventListener("change", async () => {
  disabled(true);
  try { render(await send({ type: "contributionPreference", enabled: el("help-prices").checked })); }
  catch (error) { status(error.message, true); }
  finally { disabled(false); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if (changes.sharedTask) el("shared-status").textContent = changes.sharedTask.newValue ? "Checking a shared retailer task…" : "Ready to help while idle.";
  if (changes.sharedMessage) el("shared-status").textContent = changes.sharedMessage.newValue;
});
