/* global chrome */
const form = document.getElementById("read-form");
const input = document.getElementById("url");
const button = document.getElementById("read");
const status = document.getElementById("status");
const resultPanel = document.getElementById("result");
let enabled = false;
function render(task) {
  button.disabled = enabled || task?.status === "reading";
  if (!input.value && task?.url) input.value = task.url;
  resultPanel.hidden = true;
  if (!task) { status.textContent = "Ready. Results stay in this browser session."; return; }
  if (task.status === "reading") {
    status.textContent = task.note || "Reading the Coles tab… This can take up to 90 seconds.";
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
  const state = await chrome.storage.session.get(["connection", "serverTasks"]);
  document.getElementById("connection").textContent = `${enabled ? "Running" : "Paused"}. ${state.connection || "Server: localhost:5392"}`;
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
  const reply = await chrome.runtime.sendMessage({ type: "configure", enabled: value, key: document.getElementById("worker-key").value.trim() });
  if (!reply?.ok) { status.textContent = reply?.message || "Unable to configure worker."; return; }
  enabled = value; document.getElementById("worker-key").value = "";
  document.getElementById("worker-key").placeholder = "Key saved; leave blank to keep it";
  button.disabled = enabled; await renderConnection();
}
document.getElementById("worker-form").addEventListener("submit", event => { event.preventDefault(); configure(true).catch(error => { status.textContent = error.message; }); });
document.getElementById("pause").addEventListener("click", () => { configure(false).catch(error => { status.textContent = error.message; }); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.task) render(changes.task.newValue);
  if (area === "session" && (changes.connection || changes.serverTasks)) void renderConnection();
});
chrome.runtime.sendMessage({ type: "status" }).then(reply => {
  if (reply?.ok) { enabled = reply.enabled; render(reply.task); if (reply.hasKey) document.getElementById("worker-key").placeholder = "Key saved; leave blank to keep it"; void renderConnection(); }
  else status.textContent = reply?.message || "Unable to read status.";
}).catch(() => { status.textContent = "Extension unavailable. Reload it in chrome://extensions."; });
