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
  let pumping = false;
  let timer;
  const storage = browser.storage.session;
  const ALARM = "myshoppinglist-active-import";
  async function closeTab(workflow) {
    if (workflow?.temporaryTabId != null) {
      const id = workflow.temporaryTabId; workflow.temporaryTabId = null;
      await storage.set({ workflow });
      try { await browser.tabs.remove(id); } catch { /* Already closed. */ }
    }
  }
  async function stop(workflow, message, failed = true) {
    clearTimeout(timer); await browser.alarms.clear(ALARM);
    workflow.status = failed ? "Failed" : "Completed"; workflow.message = message;
    await closeTab(workflow); await storage.set({ workflow });
  }
  async function schedule() {
    await browser.alarms.create(ALARM, { periodInMinutes: 0.5 });
    clearTimeout(timer); timer = setTimeout(() => { void pump(); }, 1000);
    timer.unref?.();
  }
  async function request(path, { method = "GET", body, anonymous = false } = {}) {
    const { token } = await storage.get("token");
    if (!anonymous && !token) throw new Error("Please sign in to your MyShoppingList account.");
    const headers = { "Content-Type": "application/json", "X-MyShoppingList-Request": "1", "X-MyShoppingList-Extension": browser.runtime.id };
    if (!anonymous) headers.Authorization = `Bearer ${token}`;
    const response = await fetcher(`${API_URL}${path}`, { method, headers, credentials: "omit", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(20000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 401 && !anonymous) await storage.remove("token");
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
    const { token, result, workflow } = await storage.get(["token", "result", "workflow"]);
    if (!token) return { session: null, lists: [], result: null, workflow };
    const session = await request("/api/auth/me");
    const lists = await request("/api/shopping-lists");
    return { session, lists, result, workflow };
  }
  function safeWork(work) {
    if (!work || !Number.isSafeInteger(work.jobId)) throw new Error("Invalid import response.");
    if (work.status !== "Waiting") return;
    const uri = new URL(work.url);
    if (work.stage === "product" && productUrl(work.url)) return;
    if (work.stage === "search" && uri.protocol === "https:" && !uri.username && !uri.password && !uri.port
      && ((uri.hostname === "www.coles.com.au" && uri.pathname === "/search/products")
        || (uri.hostname === "www.woolworths.com.au" && uri.pathname === "/shop/search/products"))) return;
    throw new Error("The server returned an unsupported retailer task.");
  }
  async function next(workflow, work) {
    safeWork(work); workflow.work = work; workflow.outbox = null;
    if (work.status !== "Waiting") {
      await stop(workflow, work.status === "Completed" ? "Product saved. Comparison finished; open your list to see the result."
        : `Product ${work.sourceSaved ? "saved; comparison" : "read"} needs retry (${work.errorCode || "interrupted"}).`, work.status !== "Completed"); return;
    }
    workflow.url = work.url; workflow.kind = work.stage; workflow.status = "Reading";
    workflow.deadline = Date.now() + 90000; workflow.message = work.stage === "search" ? "Product saved. Searching the other retailer…" : "Reading a comparison product…";
    await storage.set({ workflow });
    if (workflow.temporaryTabId == null) {
      const tab = await browser.tabs.create({ url: work.url, active: false }); workflow.temporaryTabId = tab.id;
    } else await browser.tabs.update(workflow.temporaryTabId, { url: work.url });
    workflow.tabId = workflow.temporaryTabId; await storage.set({ workflow });
  }
  async function pump() {
    if (pumping || busy) return;
    pumping = true;
    let workflow;
    try {
      workflow = (await storage.get("workflow")).workflow;
      if (!workflow || workflow.status !== "Reading") return;
      if (!workflow.outbox) {
        let result;
        if (Date.now() >= workflow.deadline) result = { ok: false };
        else {
          let tab;
          try { tab = await browser.tabs.get(workflow.tabId); } catch { result = { ok: false }; }
          if (tab) {
            if (tab.pendingUrl) { await schedule(); return; }
            const same = workflow.kind === "search" ? tab.url === workflow.url : productUrl(tab.url) === productUrl(workflow.url);
            if (!same && tab.status === "loading") { await schedule(); return; }
            if (!same) result = { ok: false };
            else {
              try { result = (await browser.scripting.executeScript({ target: { tabId: workflow.tabId, frameIds: [0] }, files: ["content.js"], world: "ISOLATED", injectImmediately: true }))[0]?.result; }
              catch { await schedule(); return; }
              if (!result || result.code === "product_not_identified") { await schedule(); return; }
              if (result.ok && workflow.kind === "search" && (result.kind !== "search" || result.url !== workflow.url)) { await schedule(); return; }
            }
          }
        }
        if (workflow.kind === "source") {
          if (!result?.ok || !result.evidence) { await stop(workflow, "Could not read this product. Keep its page open, then click Add again."); return; }
          workflow.outbox = { path: "/api/user-extension/imports/", body: { listId: workflow.listId, url: workflow.url, quantity: workflow.quantity, evidence: result.evidence, requestId: workflow.requestId } };
        } else workflow.outbox = { path: `/api/user-extension/imports/${workflow.work.jobId}/result`, body: {
          stepToken: workflow.work.stepToken, url: workflow.url, ok: !!result?.ok, evidence: result?.evidence || null,
          links: result?.links || null, emptyConfirmed: !!result?.emptyConfirmed,
        } };
        await storage.set({ workflow });
      }
      const work = await request(workflow.outbox.path, { method: "POST", body: workflow.outbox.body });
      await next(workflow, work);
      if (workflow.status === "Reading") await schedule();
    } catch (error) {
      if (workflow) await stop(workflow, `${error.message} Use Retry to resume this import.`);
    } finally { pumping = false; }
  }
  const handle = async function (message) {
    if (message.type === "state") return { ...await state(), busy };
    if (busy || pumping) throw new Error("A request is already in progress. Please wait.");
    busy = true;
    try {
      if (message.type === "login") {
        if (typeof message.email !== "string" || typeof message.password !== "string") throw new Error("Enter your email and password.");
        const result = await request("/api/user-extension/login", { method: "POST", anonymous: true, body: { email: message.email, password: message.password } });
        if (!/^[a-f0-9]{64}$/.test(result.token)) throw new Error("The server returned an invalid session.");
        const old = (await storage.get("workflow")).workflow;
        clearTimeout(timer); await browser.alarms.clear(ALARM); await closeTab(old);
        await storage.clear(); await storage.set({ token: result.token });
        return state();
      }
      if (message.type === "logout") {
        clearTimeout(timer); await browser.alarms.clear(ALARM); await closeTab((await storage.get("workflow")).workflow);
        try { await request("/api/auth/logout", { method: "POST" }); }
        finally { await storage.clear(); }
        return { session: null, lists: [] };
      }
      if (message.type === "add") {
        const previous = (await storage.get("workflow")).workflow;
        if (previous?.status === "Reading") throw new Error("Finish the current import before adding another product.");
        const url = productUrl(message.url);
        if (!url) throw new Error("Open a Coles or Woolworths product page first.");
        if (!Number.isInteger(message.quantity) || message.quantity < 1 || message.quantity > 2147483647) throw new Error("Enter a positive whole-number quantity.");
        const lists = await request("/api/shopping-lists");
        let listId = message.listId;
        if (lists.length === 0) {
          listId = (await request("/api/shopping-lists/default", { method: "POST" })).shoppingListId;
        } else if (lists.length === 1 && listId == null) listId = lists[0].id;
        if (lists.length && !lists.some(l => l.id === listId)) throw new Error("Choose one of your current shopping lists.");
        const tab = await browser.tabs.get(message.tabId);
        if (productUrl(tab.url) !== url) throw new Error("The product tab changed. Refresh the extension and try again.");
        const workflow = { status: "Reading", kind: "source", requestId: crypto.randomUUID(), url, listId, quantity: message.quantity, tabId: tab.id,
          temporaryTabId: null, deadline: Date.now() + 90000, message: "Reading the current product…" };
        await closeTab(previous); await storage.set({ workflow }); await schedule();
        return { workflow };
      }
      if (message.type === "retry") {
        const workflow = (await storage.get("workflow")).workflow;
        if (!workflow || workflow.status !== "Failed") throw new Error("There is no failed import to retry.");
        if (workflow.outbox) { workflow.status = "Reading"; await storage.set({ workflow }); }
        else if (workflow.work?.jobId) {
          await next(workflow, await request(`/api/user-extension/imports/${workflow.work.jobId}/retry`, { method: "POST" }));
        } else throw new Error("Open the source product and click Add again.");
        if (workflow.status === "Reading") await schedule();
        return { workflow };
      }
      throw new Error("Unknown action.");
    } finally { busy = false; }
  };
  return Object.assign(handle, { pump });
}

if (typeof document === "undefined" && typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  const handle = createWorker(chrome);
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "myshoppinglist-active-import") void handle.pump(); });
  chrome.tabs.onUpdated.addListener(() => { void handle.pump(); });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
    handle(message).then(data => respond({ ok: true, data }), error => respond({ ok: false,
      error: error.name === "TimeoutError" ? "Request timed out. An add may already have succeeded; check your list before trying again."
        : error instanceof TypeError ? "Cannot connect to localhost:5392. Check that the API is running." : error.message }));
    return true;
  });
}
