export const API_URL = "http://localhost:5392";

export function productUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "coles.com.au" && /^\/product\/(?:(?:[a-z0-9.'-]|%27)+-)?\d{1,15}\/?$/i.test(url.pathname)
      || host === "woolworths.com.au" && /^\/shop\/productdetails\/\d{1,15}(?:\/[a-z0-9%.'_-]+)?\/?$/i.test(url.pathname)) {
      return `https://www.${host}${url.pathname.replace(/\/$/, "")}`;
    }
  } catch { /* Unsupported tab. */ }
  return null;
}

export function createWorker(browser, fetcher = fetch) {
  let busy = false;
  const storage = browser.storage.session;
  async function request(path, { method = "GET", body, anonymous = false } = {}) {
    const { token } = await storage.get("token");
    if (!anonymous && !token) throw new Error("Please sign in to your MyShoppingList account.");
    const headers = { "Content-Type": "application/json", "X-MyShoppingList-Request": "1", "X-MyShoppingList-Extension": browser.runtime.id };
    if (!anonymous) headers.Authorization = `Bearer ${token}`;
    const response = await fetcher(`${API_URL}${path}`, { method, headers, credentials: "omit", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(20000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 401 && !anonymous) await storage.clear();
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(response.status === 401 ? "Please sign in again. Check your email and password."
        : response.status === 429 ? "Too many requests. Please wait and try again."
        : response.status >= 500 ? "The server is unavailable. Please try again later."
        : problem.title || "The request could not be completed.");
    }
    return response.status === 204 ? null : response.json();
  }
  async function state() {
    const { token, result } = await storage.get(["token", "result"]);
    if (!token) return { session: null, lists: [], result: null };
    const session = await request("/api/auth/me");
    const lists = await request("/api/shopping-lists");
    return { session, lists, result };
  }
  return async function handle(message) {
    if (message.type === "state") return { ...await state(), busy };
    if (busy) throw new Error("A request is already in progress. Please wait.");
    busy = true;
    try {
      if (message.type === "login") {
        if (typeof message.email !== "string" || typeof message.password !== "string") throw new Error("Enter your email and password.");
        const result = await request("/api/user-extension/login", { method: "POST", anonymous: true, body: { email: message.email, password: message.password } });
        if (!/^[a-f0-9]{64}$/.test(result.token)) throw new Error("The server returned an invalid session.");
        await storage.clear(); await storage.set({ token: result.token });
        return state();
      }
      if (message.type === "logout") {
        try { await request("/api/auth/logout", { method: "POST" }); }
        finally { await storage.clear(); }
        return { session: null, lists: [] };
      }
      if (message.type === "add") {
        const url = productUrl(message.url);
        if (!url) throw new Error("Open a Coles or Woolworths product page first.");
        if (!Number.isInteger(message.quantity) || message.quantity < 1 || message.quantity > 2147483647) throw new Error("Enter a positive whole-number quantity.");
        const lists = await request("/api/shopping-lists");
        let listId = message.listId;
        if (lists.length === 0) {
          listId = (await request("/api/shopping-lists/default", { method: "POST" })).shoppingListId;
        } else if (lists.length === 1 && listId == null) listId = lists[0].id;
        if (lists.length && !lists.some(l => l.id === listId)) throw new Error("Choose one of your current shopping lists.");
        const accepted = await request(`/api/shopping-lists/${listId}/products/url`, { method: "POST", body: { url, quantity: message.quantity } });
        const result = { url, listId, jobId: accepted.jobId, reused: accepted.reused, quantity: accepted.quantity };
        await storage.set({ result });
        return { result };
      }
      throw new Error("Unknown action.");
    } finally { busy = false; }
  };
}

if (typeof document === "undefined" && typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  const handle = createWorker(chrome);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
    handle(message).then(data => respond({ ok: true, data }), error => respond({ ok: false,
      error: error.name === "TimeoutError" ? "Request timed out. An add may already have succeeded; check your list before trying again."
        : error instanceof TypeError ? "Cannot connect to localhost:5392. Check that the API is running." : error.message }));
    return true;
  });
}
