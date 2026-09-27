/* global chrome */
const form = document.getElementById("read-form");
const input = document.getElementById("url");
const button = document.getElementById("read");
const status = document.getElementById("status");
const resultPanel = document.getElementById("result");
let enabled = false;
const toggle = document.getElementById("enable");
let configuring = false;
function renderWorkerState(value) {
  enabled = !!value;
  toggle.textContent = enabled ? "Stop worker" : "Start worker";
  toggle.dataset.running = String(enabled);
  toggle.disabled = configuring;
}
function render(task) {
  button.disabled = enabled || task?.status === "reading";
  if (task?.remote || !input.value) input.value = task?.kind === "search" ? "" : task?.url || "";
  resultPanel.hidden = true;
  if (!task) { status.textContent = "Ready. Results stay in this browser session."; return; }
  if (task.status === "reading") {
    status.textContent = task.note || (task.kind === "search"
      ? `Searching Coles for “${task.remote?.query || new URL(task.url).searchParams.get("q") || "product"}”…`
      : "Reading the Coles product… This can take up to 90 seconds.");
    return;
  }
  const result = task.result;
  if (!result?.ok) { status.textContent = result?.message || "The read could not be completed."; return; }
  if (result.kind === "search") { status.textContent = `Search complete: ${result.links.length} candidates.`; return; }
  status.textContent = result.priceIssue ? "Product identified; single-item price could not be verified." : "Product and price read successfully.";
  resultPanel.hidden = false;
  document.getElementById("name").textContent = result.name;
  document.getElementById("price").textContent = result.price === null ? "Price unavailable" :
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(result.price) + " each";
  document.getElementById("promotion").textContent = result.promotion || "No promotion found in the product data.";
  const display = { ...result }; delete display.evidence;
  document.getElementById("json").textContent = JSON.stringify(display, null, 2);
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  button.disabled = true;
  resultPanel.hidden = true;
  status.textContent = "Opening product tab…";
  try {
    const reply = await chrome.runtime.sendMessage({ type: "start", url: input.value.trim() });
    if (!reply?.ok) { button.disabled = false; status.textContent = reply?.message || "Unable to start."; }
  } catch { button.disabled = false; status.textContent = "Extension unavailable. Reload it in chrome://extensions and try again."; }
});
async function renderConnection() {
  const state = await chrome.storage.session.get(["connection", "serverTasks", "task"]);
  const mode = enabled ? "Running" : state.task?.status === "reading" ? "Stopping after the current task" : "Stopped";
  document.getElementById("connection").textContent = `${mode}. ${state.connection || "Server: localhost:5392"}`;
  const container = document.getElementById("queue"); container.replaceChildren();
  const tasks = state.serverTasks || [];
  const count = document.createElement("p"); count.textContent = `${tasks.filter(t => t.status === "Waiting").length} waiting tasks`; container.append(count);
  for (const task of tasks.filter(t => t.status === "Failed")) {
    const row = document.createElement("p"); row.textContent = `Task ${task.id}: ${task.errorCode || "failed"} `;
    const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      try { const reply = await chrome.runtime.sendMessage({ type: "retry", id: task.id }); if (!reply?.ok) throw new Error(reply?.message || "Retry failed"); row.remove(); }
      catch (error) { status.textContent = error.message; retry.disabled = false; }
    }); row.append(retry); container.append(row);
  }
}
async function configure(value) {
  const reply = await chrome.runtime.sendMessage({ type: "configure", enabled: value, key: value ? document.getElementById("worker-key").value.trim() : "" });
  if (!reply?.ok) { status.textContent = reply?.message || "Unable to configure worker."; return; }
  renderWorkerState(value); document.getElementById("worker-key").value = "";
  document.getElementById("worker-key").placeholder = "Key saved; leave blank to keep it";
  render((await chrome.storage.session.get("task")).task); await renderConnection();
}
document.getElementById("worker-form").addEventListener("submit", async event => {
  event.preventDefault(); if (toggle.disabled || configuring) return;
  configuring = true; toggle.disabled = true;
  try { await configure(!enabled); } catch (error) { status.textContent = error.message; }
  finally { configuring = false; renderWorkerState(enabled); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) { renderWorkerState(changes.settings.newValue?.enabled); void renderConnection(); }
  if (area === "session" && changes.task) { render(changes.task.newValue); void renderConnection(); }
  if (area === "session" && (changes.connection || changes.serverTasks)) void renderConnection();
});
chrome.runtime.sendMessage({ type: "status" }).then(reply => {
  if (reply?.ok) { renderWorkerState(reply.enabled); render(reply.task); if (reply.hasKey) document.getElementById("worker-key").placeholder = "Key saved; leave blank to keep it"; void renderConnection(); }
  else status.textContent = reply?.message || "Unable to read status.";
}).catch(() => { status.textContent = "Extension unavailable. Reload it in chrome://extensions."; });
