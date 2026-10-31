const el = id => document.getElementById(id);
let busy = false, model = {}, refreshTimer;
let pendingFeedback;
const paragraph = text => { const p = document.createElement("p"); p.textContent = text; return p; };
function detail(task) {
  const fragment = document.createDocumentFragment();
  fragment.append(paragraph(`${task.clientName} requested ${task.type === "capture" ? "a product capture" : "a search"} at ${task.retailer}.`),
    paragraph(task.url), paragraph(`Expires ${new Date(task.expiresAt).toLocaleString()}.`));
  if (task.type === "capture") fragment.append(paragraph(`Save quantity ${task.quantity} to “${task.listName || "Unavailable list"}”. If already on the list, this replaces its quantity.`));
  else fragment.append(paragraph("Read up to five product links from this search page. No product will be added to your list."));
  return fragment;
}
function render(data) {
  model = data;
  el("account").textContent = data.account ? `Signed in as ${data.account.displayName}` : "Sign in on the MyShoppingList website, then refresh this page.";
  el("link").hidden = !data.signedIn || !data.enabled || data.linked;
  el("unlink").hidden = !data.linked;
  el("feedback-section").hidden = !data.signedIn || !data.feedbackEnabled;
  el("requests").replaceChildren();
  if (!data.enabled) el("requests").append(paragraph("AI requests are not enabled on this server."));
  else if (!data.linked) el("requests").append(paragraph("Link this extension to receive requests from your connected AI apps."));
  else {
    const pending = (data.tasks || []).filter(t => t.id !== data.active?.task.id);
    if (!pending.length) el("requests").append(paragraph("No pending requests. Keep this page open while asking your AI for a capture or search."));
    for (const task of pending) {
      const card = document.createElement("article"); card.append(detail(task));
      const approve = document.createElement("button"); approve.textContent = "Open page and review";
      approve.disabled = !!data.active; approve.addEventListener("click", () => action("ai-approve", task.id));
      const decline = document.createElement("button"); decline.textContent = "Decline"; decline.className = "secondary";
      decline.addEventListener("click", () => action("ai-decline", task.id));
      card.append(approve, decline); el("requests").append(card);
    }
  }
  el("active").hidden = !data.active;
  el("active-detail").replaceChildren(); el("review").replaceChildren();
  if (data.active) {
    const { task, review, canSave } = data.active;
    el("active-detail").append(detail(task));
    el("save").hidden = !canSave; el("resume").hidden = canSave;
    el("resume").onclick = () => action("ai-approve", task.id);
    el("save").textContent = task.type === "capture" ? "Save to list / Retry save" : "Share reviewed links / Retry";
    if (review && task.type === "capture") {
      el("review").append(paragraph(review.name), paragraph(review.price == null ? "Price unavailable" :
        new Intl.NumberFormat("en-AU", { style: "currency", currency: review.currency || "AUD" }).format(review.price)),
        paragraph(review.priceNotice || "Saved observation only; store location is not verified."));
    } else if (review) {
      for (const c of review.candidates) el("review").append(paragraph(c.url));
      if (review.emptyConfirmed) el("review").append(paragraph("This search page explicitly reported no results."));
    } else el("review").append(paragraph("The request was approved but has no review ready. Open the page again, or cancel."));
  }
  el("outcome").hidden = !data.outcome;
  el("outcome-detail").textContent = data.outcome ? `${data.outcome.type === "capture" ? "Capture" : "Search"}: ${data.outcome.status}${data.outcome.errorCode ? ` (${data.outcome.errorCode})` : ""}.` : "";
}
async function action(type, taskId, fields = {}) {
  if (busy) return;
  busy = true;
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  el("status").textContent = type === "ai-approve" ? "Opening the approved page. Review before saving or sharing…" : "Checking…";
  try {
    const reply = await chrome.runtime.sendMessage({ type, taskId, interactive: !document.hidden, ...fields });
    if (!reply?.ok) throw new Error(reply?.error || "The extension did not respond. Refresh to try again.");
    render(reply.data); el("status").textContent = "";
    if (reply.data.feedbackReceived) {
      pendingFeedback = null; el("feedback-fields").disabled = false; el("feedback-message").value = "";
      el("send-feedback").textContent = "Send feedback"; el("feedback-status").textContent = "Feedback sent privately. View your ticket and any response on the website.";
    }
  } catch (error) { el("status").textContent = error.message; }
  finally {
    busy = false;
    for (const button of document.querySelectorAll("button")) button.disabled = false;
    if (model.active) for (const button of el("requests").querySelectorAll("button:first-of-type")) button.disabled = true;
  }
}
el("link").onclick = () => action("ai-link"); el("unlink").onclick = () => action("ai-unlink");
el("refresh").onclick = () => action("ai-state"); el("save").onclick = () => action("ai-save");
el("cancel").onclick = () => action("ai-cancel");
el("feedback").onsubmit = event => {
  event.preventDefault();
  if (!model.account || busy) return;
  pendingFeedback ??= { expectedAccountId: model.account.id, requestId: crypto.randomUUID(),
    category: el("feedback-category").value, message: el("feedback-message").value };
  el("feedback-fields").disabled = true; el("send-feedback").textContent = "Retry sending feedback";
  void action("ai-feedback", undefined, pendingFeedback);
};
document.addEventListener("visibilitychange", () => {
  clearInterval(refreshTimer);
  if (!document.hidden) { void action("ai-state"); refreshTimer = setInterval(() => void action("ai-state"), 15000); }
  else if (!busy) void action("ai-state");
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.token) {
    model = {}; pendingFeedback = null; el("feedback-fields").disabled = false; el("feedback-message").value = "";
    el("feedback-status").textContent = ""; render({}); void action("ai-state");
  }
});
void action("ai-state"); refreshTimer = setInterval(() => { if (!document.hidden) void action("ai-state"); }, 15000);
