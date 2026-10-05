(() => {
  if (globalThis.myShoppingListPanel) {
    void globalThis.myShoppingListPanel();
    return;
  }
  let host;
  let ticket;
  let pageUrl;
  let version = 0;
  async function refresh() {
    const read = ++version;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "panel-state",
      });
      if (read !== version) return;
      if (!response?.ok || !response.data.show) {
        host?.remove();
        host = null;
        ticket = null;
        return;
      }
      if (
        host?.isConnected &&
        ticket === response.data.ticket &&
        pageUrl === location.href
      )
        return;
      pageUrl = location.href;
      host?.remove();
      ticket = response.data.ticket;
      host = document.createElement("div");
      // Closed shadow DOM protects the frame URL and its per-tab ticket from page scripts.
      const shadow = host.attachShadow({ mode: "closed" });
      host.style.cssText =
        "all:initial!important;position:fixed!important;right:12px!important;top:clamp(12px,66vh,calc(100vh - 250px))!important;width:min(218px,calc(100vw - 24px))!important;height:238px!important;z-index:2147483647!important;display:block!important;";
      const frame = document.createElement("iframe");
      frame.src = chrome.runtime.getURL(
        `compact.html?ticket=${encodeURIComponent(ticket)}`,
      );
      frame.title = "MyShoppingList quick add";
      frame.style.cssText =
        "display:block;width:100%;height:100%;border:0;border-radius:16px;box-shadow:0 4px 24px #16304730;color-scheme:light;";
      shadow.append(frame);
      document.documentElement.append(host);
    } catch (error) {
      host?.remove();
      host = null;
      console.warn("MyShoppingList panel:", error.message);
    }
  }
  globalThis.myShoppingListPanel = refresh;
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "panel-changed") void refresh();
  });
  window.addEventListener("pageshow", refresh);
  void refresh();
})();
