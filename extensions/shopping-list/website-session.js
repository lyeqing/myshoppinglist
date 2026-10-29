// Credentials never enter page JavaScript. Reattachment replaces our listeners.
if (["http://localhost:3000", "http://localhost:3001"].includes(location.origin)) {
  globalThis.myShoppingListWebsiteBridge?.dispose();
  const announce = () => window.postMessage({ channel: "myshoppinglist-price-refresh-ready", version: 2,
    extensionId: chrome.runtime.id }, location.origin);
  const receive = async (event) => {
    // Chrome can retain DOM listeners from an invalidated isolated world.
    // They must stay silent rather than race the replacement bridge's reply.
    try { if (!chrome.runtime.id) return; } catch { return; }
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin
        || request?.channel !== "myshoppinglist-price-refresh-request-v2"
        || typeof request.requestId !== "string"
        || !["hello", "start", "next", "cancel"].includes(request.action)) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "website-price-refresh",
        action: request.action, accountId: request.accountId, listId: request.listId,
        runId: request.runId, targets: request.targets });
      window.postMessage({ channel: "myshoppinglist-price-refresh-response-v2",
        requestId: request.requestId, ...result }, location.origin);
    } catch (error) {
      if (/extension context invalidated/i.test(error?.message || "")) return;
      window.postMessage({ channel: "myshoppinglist-price-refresh-response-v2", requestId: request.requestId,
        ok: false, code: "extension_unavailable", error: "The extension connection was interrupted. Reload the extension or this page, then try again." }, location.origin);
    }
  };
  const notify = (message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "myshoppinglist-session-changed")
      window.dispatchEvent(new Event("myshoppinglist-session-changed"));
    if (message?.type === "website-bridge-ping") { announce(); respond({ version: 2 }); }
  };
  window.addEventListener("message", receive);
  chrome.runtime.onMessage.addListener(notify);
  globalThis.myShoppingListWebsiteBridge = { dispose: () => {
    window.removeEventListener("message", receive);
    try { chrome.runtime.onMessage.removeListener(notify); } catch { /* Old extension context was invalidated. */ }
  } };
  announce();
}
