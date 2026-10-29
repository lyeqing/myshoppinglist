export interface ExtensionRefreshTarget { itemId: number; mappingId: number; name: string; url: string }
export interface ExtensionRefreshFailure extends ExtensionRefreshTarget { message: string }
export interface ExtensionRefreshProgress {
  runId: string;
  total: number;
  completed: number;
  updated: number;
  failed: number;
  message: string;
  done: boolean;
  failures: ExtensionRefreshFailure[];
  pending: ExtensionRefreshTarget[];
}

export class ExtensionUnavailable extends Error {}

const extensionIdKey = "myshoppinglist-extension-id";
type Reply = { ok: boolean; data?: unknown; error?: string; code?: string };
type ChromeRuntime = { lastError?: { message?: string };
  sendMessage: (extensionId: string, message: unknown, callback: (reply?: Reply) => void) => void };
export function rememberExtensionId(value: unknown) {
  if (typeof value === "string" && /^[a-p]{32}$/.test(value)) {
    try { localStorage.setItem(extensionIdKey, value); } catch { /* The content bridge remains available. */ }
  }
}

export function extensionRequest<T>(action: "hello" | "start" | "next" | "cancel",
  payload: { accountId?: number; listId?: number; runId?: string;
    targets?: Pick<ExtensionRefreshTarget, "itemId" | "mappingId">[] } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let finished = false;
    const finish = () => {
      finished = true;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      window.removeEventListener("message", ready);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin
          || event.data?.channel !== "myshoppinglist-price-refresh-response-v2"
          || event.data.requestId !== requestId) return;
      complete(event.data);
    };
    const complete = (reply: Reply) => {
      if (finished) return;
      finish();
      if (!reply.ok) reject(action === "hello" || reply.code === "extension_unavailable"
        ? new ExtensionUnavailable(reply.error) : new Error(reply.error || "The extension could not update prices."));
      else {
        if (action === "hello") rememberExtensionId((reply.data as { extensionId?: string })?.extensionId);
        resolve(reply.data as T);
      }
    };
    const timer = setTimeout(() => {
      finish();
      reject(new ExtensionUnavailable(action === "hello" ? "Couldn’t connect to your extension."
        : "The extension stopped responding. Reconnect, then retry unfinished items."));
    }, action === "hello" ? 4000 : 45000);
    let replayed = false;
    const ready = (event: MessageEvent) => {
      if (action === "hello" && !replayed && isExtensionReady(event)) {
        rememberExtensionId(event.data.extensionId); replayed = true; send();
      }
    };
    const bridge = () => window.postMessage({ channel: "myshoppinglist-price-refresh-request-v2", requestId, action, ...payload }, location.origin);
    const send = () => {
      if (finished) return;
      const runtime = (window as Window & { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
      let extensionId;
      try { extensionId = localStorage.getItem(extensionIdKey); } catch { /* Use the bridge. */ }
      if (!runtime?.sendMessage || !extensionId || !/^[a-p]{32}$/.test(extensionId)) { bridge(); return; }
      const disconnected = () => {
        // Only a connection probe is safe to replay. A lost update response can
        // follow a committed observation, so preserve its unconfirmed outcome.
        if (finished) return;
        if (action === "hello") bridge();
        else complete({ ok: false, code: "extension_unavailable", error: "The extension connection was interrupted. Reconnect and retry unfinished items." });
      };
      try {
        runtime.sendMessage(extensionId, { type: "website-price-refresh", action, ...payload }, reply => {
          if (runtime.lastError || !reply) disconnected(); else complete(reply);
        });
      } catch { disconnected(); }
    };
    window.addEventListener("message", receive);
    window.addEventListener("message", ready);
    send();
  });
}

export function isExtensionReady(event: MessageEvent) {
  return event.source === window && event.origin === location.origin
    && event.data?.channel === "myshoppinglist-price-refresh-ready" && event.data.version === 2;
}
