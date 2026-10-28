export interface ExtensionRefreshProgress {
  runId: string;
  total: number;
  completed: number;
  updated: number;
  failed: number;
  message: string;
  done: boolean;
}

export class ExtensionUnavailable extends Error {}

export function extensionRequest<T>(action: "hello" | "start" | "next" | "cancel",
  payload: { accountId?: number; listId?: number; runId?: string } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin
          || event.data?.channel !== "myshoppinglist-price-refresh-response"
          || event.data.requestId !== requestId) return;
      finish();
      if (!event.data.ok) reject(action === "hello"
        ? new ExtensionUnavailable(event.data.error) : new Error(event.data.error || "The extension could not update prices."));
      else resolve(event.data.data as T);
    };
    const timer = setTimeout(() => {
      finish();
      reject(action === "hello" ? new ExtensionUnavailable("Couldn’t connect to your extension.")
        : new Error("The extension stopped responding. Check that it is enabled and try again."));
    }, action === "hello" ? 1500 : 45000);
    window.addEventListener("message", receive);
    window.postMessage({ channel: "myshoppinglist-price-refresh-request", requestId, action, ...payload }, location.origin);
  });
}
