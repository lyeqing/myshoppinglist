// A notification only: credentials never enter page JavaScript.
if (["http://localhost:3000", "http://localhost:3001"].includes(location.origin)) {
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message?.type === "myshoppinglist-session-changed")
      window.dispatchEvent(new Event("myshoppinglist-session-changed"));
  });
}
