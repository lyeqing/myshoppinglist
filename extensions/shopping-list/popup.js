const el = (id) => document.getElementById(id);
const compact = location.pathname.endsWith("/compact.html");
let busy = false;
let model = {};
let tabId;
let refreshing = false;
let refreshAgain = false;
function status(message, error = false) {
  el("status").textContent = message || "";
  el("status").className = error ? "error" : "";
}
async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || "The extension could not complete the request.");
  return reply.data;
}
function controls() {
  const locked = busy || model.pending || model.workflow?.status === "Saving";
  const ready = !!model.session && !!model.productUrl;
  for (const id of ["list", "quantity", "cancel"]) el(id).disabled = locked;
  el("read").hidden = !!model.review;
  el("read").disabled = locked || !ready;
  el("save").disabled = locked || !ready || !model.review;
  el("retry").hidden = !model.pending;
  el("retry").disabled = busy;
  el("refresh").disabled = busy;
  if (el("minimize")) el("minimize").disabled = busy || !model.session;
}
function render(data) {
  model = { ...model, ...data };
  tabId = model.tabId;
  el("login").hidden = !!model.session || compact;
  el("account").hidden = !model.session;
  el("name").textContent = model.session?.account?.displayName || "";
  el("product").textContent = model.productUrl
    ? "Read this product, review the details, then save."
    : "Open a Coles, Woolworths or ALDI product page.";
  if (data.lists) {
    const remembered = Number(el("list").value);
    el("list").replaceChildren(...data.lists.map((list) => {
      const option = document.createElement("option");
      option.value = String(list.id); option.textContent = list.name; return option;
    }));
    const selected = data.lists.some((list) => list.id === remembered) ? remembered : model.selectedListId;
    if (selected != null) el("list").value = String(selected);
    el("list-label").hidden = !data.lists.length;
    el("empty").hidden = !!data.lists.length;
  }
  if (model.pending && model.quantity != null) el("quantity").value = String(model.quantity);
  const review = model.review;
  el("review").hidden = !review;
  if (review) {
    el("review-name").textContent = review.name;
    el("review-detail").textContent = [review.brand,
      [review.packQuantity && review.packQuantity > 1 ? review.packQuantity + " ×" : "", review.packSize, review.packUnit].filter(Boolean).join(" ")
    ].filter(Boolean).join(" · ");
    el("review-price").textContent = review.price == null ? "Price unavailable"
      : new Intl.NumberFormat("en-AU", { style: "currency", currency: review.currency || "AUD" }).format(review.price);
    el("review-notice").textContent = review.priceNotice || "";
    el("review-date").textContent = "Observed " + new Date(review.observedAt).toLocaleString();
  }
  status(model.workflow?.message || (model.session ? "Ready when you are." : "Sign in to save personal products."),
    ["Pending", "Failed"].includes(model.workflow?.status));
  controls();
}
async function refresh() {
  if (busy || refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try { render(await send({ type: "state" })); }
  catch (error) { status(error.message, true); }
  finally { refreshing = false; controls(); }
}
async function action(message, progress) {
  if (busy) return;
  busy = true; controls(); status(progress);
  try { render(await send(message)); }
  catch (error) {
    // Read state after errors so an uncertain save exposes its stable Retry action.
    try { render(await send({ type: "state" })); } catch { /* Keep the last view. */ }
    status(error.message, true);
  } finally {
    busy = false; controls();
    if (refreshAgain) { refreshAgain = false; void refresh(); }
  }
}
el("read").addEventListener("click", () => action({ type: "preview" }, "Reading this product…"));
el("add").addEventListener("submit", (event) => {
  event.preventDefault();
  void action({ type: "save", quantity: Number(el("quantity").value),
    listId: el("list").value ? Number(el("list").value) : null }, "Saving to your list…");
});
el("list").addEventListener("change", () => action({ type: "selectList", listId: Number(el("list").value) }, "Selecting list…"));
el("cancel").addEventListener("click", () => action({ type: "cancel" }, "Cancelling preview…"));
el("retry").addEventListener("click", () => action({ type: "retry" }, "Checking your save…"));
el("refresh").addEventListener("click", refresh);
el("login").addEventListener("submit", (event) => {
  event.preventDefault();
  const password = el("password").value;
  el("password").value = "";
  void action({ type: "login", email: el("email").value, password }, "Signing in…");
});
el("logout").addEventListener("click", () => action({ type: "logout" }, "Signing out…"));
el("hide").addEventListener("click", () => { void send({ type: "panel-hide" }).catch((error) => status(error.message, true)); });
el("minimize")?.addEventListener("click", () => { void send({ type: "panel-minimize" }).catch((error) => status(error.message, true)); });
el("expand")?.addEventListener("click", () => {
  if (tabId != null) void chrome.sidePanel.open({ tabId }).then(() => send({ type: "panel-expand" }))
    .catch((error) => status(error.message, true));
});
el("extension-id").textContent = chrome.runtime.id;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if (changes.token) {
    // Clear cached account details immediately, before the next API request.
    model = {}; render({ session: null, review: null, pending: false, workflow: null });
  }
  if (["token", "review", "pending", "workflow"].some((key) => changes[key])) void refresh();
});
chrome.runtime.onMessage.addListener((message) => { if (message.type === "panel-changed") void refresh(); });
void refresh();