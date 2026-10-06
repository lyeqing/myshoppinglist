const el = (id) => document.getElementById(id);
let busy = false;
let active = false;
let available = false;
let refreshing = false;
let tabId;
let currentProductUrl;
async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok)
    throw new Error(reply?.error || "Open the full view to try again.");
  return reply.data;
}
function status(text, error = false) {
  el("status").textContent = text;
  el("status").className = error ? "error" : "";
}
function controls() {
  el("add-button").disabled = busy || active || !available;
  el("quantity").disabled = busy || active;
}
function progress(workflow) {
  active = workflow?.status === "Reading";
  const matches =
    currentProductUrl &&
    workflow?.url &&
    currentProductUrl.replace(/%2b/gi, "+") ===
      workflow.url.replace(/%2b/gi, "+");
  if (matches) status(workflow.message, workflow.status === "Failed");
  else
    status(
      active
        ? "Another product is being added. Please wait."
        : available
          ? "Ready to add to this list."
          : "Open a product page to add.",
    );
  controls();
}
async function refresh() {
  if (refreshing || busy) return;
  refreshing = true;
  try {
    const data = await send({ type: "state" });
    tabId = data.tabId;
    currentProductUrl = data.productUrl;
    available = !!data.session && !!data.productUrl;
    const list = data.lists?.find((value) => value.id === data.selectedListId);
    el("list").textContent = list?.name || "New shopping list";
    el("list").title = list?.name || "A list will be created when you add";
    status(
      available ? "Ready to add to this list." : "Open a product page to add.",
    );
    progress(data.workflow);
  } catch (error) {
    available = false;
    status(error.message, true);
  } finally {
    refreshing = false;
    controls();
  }
}
el("add").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || active || !available) return;
  busy = true;
  controls();
  status("Adding product…");
  try {
    progress(
      (await send({ type: "add", quantity: Number(el("quantity").value) }))
        .workflow,
    );
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
    controls();
  }
});
el("expand").addEventListener("click", () => {
  if (tabId == null) return;
  void chrome.sidePanel
    .open({ tabId })
    .then(() => send({ type: "panel-expand" }))
    .catch((error) => status(error.message, true));
});
el("hide").addEventListener("click", () => {
  void send({ type: "panel-hide" }).catch((error) =>
    status(error.message, true),
  );
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if (changes.workflow) progress(changes.workflow.newValue);
  if (changes.token || changes.selectedListId) void refresh();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "panel-changed") void refresh();
});
void refresh();
