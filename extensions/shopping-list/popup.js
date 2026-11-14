const el = (id) => document.getElementById(id);
const compact = location.pathname.endsWith("/compact.html");
let busy = false;
let model = {};
let tabId;
let refreshing = false;
let refreshAgain = false;
let comparisonJobId;
let selectedComparisonJobId;
function status(message, error = false) {
  el("status").textContent = message || "";
  el("status").title = message || "";
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
  el("quick-add").hidden = !!model.review || !!model.pending;
  el("quick-add").disabled = locked || !ready;
  if (el("review-full")) {
    el("review-full").hidden = !model.review || !!model.pending;
    el("review-full").disabled = busy;
  }
  el("read").disabled = locked || !ready;
  el("save").disabled = locked || !ready || !model.review;
  el("retry").hidden = !model.pending;
  el("retry").disabled = busy;
  el("refresh").disabled = busy;
  for (const operation of ["cancel", "resume", "retry", "open"]) el("comparison-" + operation).disabled = busy;
  if (el("minimize")) el("minimize").disabled = busy || !model.session;
}
function render(data) {
  model = { ...model, ...data };
  tabId = model.tabId;
  el("login").hidden = !!model.session || compact;
  el("account").hidden = !model.session;
  el("name").textContent = model.session?.account?.displayName || "";
  el("product").textContent = model.productUrl
    ? "Add to your list, or read the details first."
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
  if ((model.pending || model.review) && model.quantity != null) el("quantity").value = String(model.quantity);
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
  status(model.session && !model.productUrl ? "Open a Coles, Woolworths or ALDI product page."
    : model.workflow?.message || (model.session ? "Ready when you are." : "Sign in to save personal products."),
    ["Pending", "Failed"].includes(model.workflow?.status));
  controls();
  renderComparisons();
}
function renderComparisons() {
  const jobs = model.comparisons || [];
  const job = jobs.find(j => j.jobId === selectedComparisonJobId) || jobs.find(j => !j.response || ["Checking", "Paused"].includes(j.response.status)) || jobs.at(-1);
  el("comparisons").hidden = !job;
  document.body.classList.toggle("comparing", !!job);
  if (!job) return;
  comparisonJobId = job.jobId;
  el("comparison-selection-label").hidden = jobs.length < 2;
  el("comparison-selection").replaceChildren(...jobs.map(j => {
    const option = document.createElement("option"); option.value = String(j.jobId);
    option.textContent = `${j.response?.productName || "Saved product"} · ${j.paused ? "Needs attention" : j.response?.status || "Waiting"}`;
    return option;
  }));
  el("comparison-selection").value = String(job.jobId);
  const response = job.response;
  el("comparison-product").textContent = response?.productName || "";
  const working = !job.paused && (!response || response.status === "Checking");
  const verification = response?.status === "Paused";
  const retry = response && ["Partial", "Cancelled"].includes(response.status);
  const current = { coles: "Coles", woolworths: "Woolworths", aldi: "ALDI" }[response?.work?.retailer] || "retailers";
  const message = job.error || (job.paused && !retry ? "Product saved. Resume retailer checks when ready."
    : working ? `Product saved. Checking ${current}…`
    : response?.status === "Completed" ? "Product saved. Retailer checks complete."
    : response?.status === "Cancelled" ? "Product saved. Retailer checks stopped." : "Product saved. Some retailer checks need attention.");
  el("comparison-summary").textContent = message;
  if (compact && !busy && !model.pending && !model.review
    && (model.workflow?.captureJobId == null || model.workflow.captureJobId === job.jobId)) status(message);
  el("comparison-cancel").hidden = !working;
  el("comparison-resume").hidden = !job.paused || !!retry;
  el("comparison-retry").hidden = !retry;
  el("comparison-open").hidden = !verification || !job.paused;
  const results = el("comparison-results"); results.replaceChildren();
  for (const retailer of response?.retailers || []) {
    const section = document.createElement("section");
    const heading = document.createElement("h3"); heading.textContent = retailer.name;
    const outcome = document.createElement("p");
    outcome.textContent = retailer.message || ({ Pending: "Waiting to check", Checking: "Checking…", NoMatch: "No match found in the checked results." }[retailer.status] || retailer.status);
    section.append(heading, outcome);
    for (const [title, candidates] of [["Exact matches", retailer.exactMatches], ["Alternatives · excluded from exact totals", retailer.alternatives]]) {
      if (!candidates?.length) continue;
      const label = document.createElement("p"); label.className = "product-name"; label.textContent = title; section.append(label);
      for (const candidate of candidates) {
        const line = document.createElement("p"); const link = document.createElement("a");
        let url;
        try { url = new URL(candidate.url); } catch { continue; }
        if (url.origin !== `https://www.${retailer.code}.com.au` || url.username || url.password) continue;
        link.href = url.href; link.target = "_blank"; link.rel = "noreferrer"; link.textContent = candidate.name;
        line.append(link, document.createTextNode(` · ${candidate.relationship} · ${candidate.price == null ? "Price unavailable" : new Intl.NumberFormat("en-AU", { style: "currency", currency: candidate.currency || "AUD" }).format(candidate.price)}`));
        const detail = document.createElement("small");
        detail.textContent = `${candidate.priceNotice || ""} · Observed ${new Date(candidate.observedAt).toLocaleString()}. Store location unverified.`;
        line.append(document.createElement("br"), detail); section.append(line);
      }
    }
    results.append(section);
  }
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
function selection(type) {
  return { type, quantity: Number(el("quantity").value),
    listId: el("list").value ? Number(el("list").value) : null };
}
function expandPanel() {
  return chrome.sidePanel.open({ tabId }).then(() => send({ type: "panel-expand" }));
}
el("quick-add").addEventListener("click", () => {
  if (el("add").reportValidity()) void action(selection("add"), "Reading and adding to your list…");
});
el("read").addEventListener("click", () => {
  if (!compact) { void action(selection("preview"), "Reading this product…"); return; }
  // Start opening the native panel inside the user's click gesture. Keep this
  // frame alive until its read finishes, then transfer control to full view.
  void chrome.sidePanel.open({ tabId }).then(async () => {
    await action(selection("preview"), "Reading this product…");
    await send({ type: "panel-expand" });
  }).catch(error => status(error.message, true));
});
el("review-full")?.addEventListener("click", () => {
  void expandPanel().catch(error => status(error.message, true));
});
el("add").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(selection(model.review ? "save" : "add"), "Saving to your list…");
});
el("list").addEventListener("change", () => action({ type: "selectList", listId: Number(el("list").value) }, "Selecting list…"));
el("cancel").addEventListener("click", () => action({ type: "cancel" }, "Cancelling preview…"));
el("retry").addEventListener("click", () => action({ type: "retry" }, "Checking your save…"));
el("refresh").addEventListener("click", refresh);
el("ai-requests")?.addEventListener("click", () => {
  void send({ type: "open-ai-requests" }).catch(error => status(error.message, true));
});
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
  if (["token", "review", "pending", "workflow", "personalComparisons"].some((key) => changes[key])) void refresh();
});
chrome.runtime.onMessage.addListener((message) => { if (message.type === "panel-changed") void refresh(); });
void refresh();

for (const action of ["cancel", "resume", "retry", "open"])
  el("comparison-" + action).addEventListener("click", () => {
    void actionComparison(action);
  });
async function actionComparison(operation) {
  await action({ type: "comparison", action: operation, jobId: comparisonJobId }, "Updating retailer checks…");
  renderComparisons();
}

el("comparison-selection").addEventListener("change", () => {
  selectedComparisonJobId = Number(el("comparison-selection").value); renderComparisons();
});
