// A notification only: credentials never enter page JavaScript.
if (["http://localhost:3000", "http://localhost:3001"].includes(location.origin)) {
  window.addEventListener("message", async (event) => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin
        || request?.channel !== "myshoppinglist-price-refresh-request"
        || typeof request.requestId !== "string"
        || !["hello", "start", "next", "cancel"].includes(request.action)) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "website-price-refresh",
        action: request.action, accountId: request.accountId, listId: request.listId, runId: request.runId });
      window.postMessage({ channel: "myshoppinglist-price-refresh-response",
        requestId: request.requestId, ...result }, location.origin);
    } catch {
      window.postMessage({ channel: "myshoppinglist-price-refresh-response", requestId: request.requestId,
        ok: false, error: "Couldn’t connect to the extension. Enable or reload it, then try again." }, location.origin);
    }
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message?.type === "myshoppinglist-session-changed")
      window.dispatchEvent(new Event("myshoppinglist-session-changed"));
  });
}
