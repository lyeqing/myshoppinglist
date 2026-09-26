/* global chrome */
const form = document.getElementById("read-form");
const input = document.getElementById("url");
const button = document.getElementById("read");
const status = document.getElementById("status");
const resultPanel = document.getElementById("result");
function render(task) {
  button.disabled = task?.status === "reading";
  if (!input.value && task?.url) input.value = task.url;
  resultPanel.hidden = true;
  if (!task) { status.textContent = "Ready. Results stay in this browser session."; return; }
  if (task.status === "reading") {
    status.textContent = task.note || "Reading the Coles tab… This can take up to 90 seconds.";
    return;
  }
  const result = task.result;
  if (!result?.ok) { status.textContent = result?.message || "The read could not be completed."; return; }
  status.textContent = result.priceIssue ? "Product identified; single-item price could not be verified." : "Product and price read successfully.";
  resultPanel.hidden = false;
  document.getElementById("name").textContent = result.name;
  document.getElementById("price").textContent = result.price === null ? "Price unavailable" :
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(result.price) + " each";
  document.getElementById("promotion").textContent = result.promotion || "No promotion found in the product data.";
  document.getElementById("json").textContent = JSON.stringify(result, null, 2);
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
chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.task) render(changes.task.newValue); });
chrome.runtime.sendMessage({ type: "status" }).then(reply => {
  if (reply?.ok) render(reply.task);
  else status.textContent = reply?.message || "Unable to read status.";
}).catch(() => { status.textContent = "Extension unavailable. Reload it in chrome://extensions."; });
