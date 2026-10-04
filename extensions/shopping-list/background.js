export const API_URL = "http://localhost:5392";
export const WEBSITE_URL = "http://localhost:3000/";
const SESSION_COOKIE = "myshoppinglist_session";

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
  let sharing = false;
  let sharedTimer;
  const sharedWaiters = [];
  const SHARED_ALARM = "myshoppinglist-shared-prices";
  const storage = browser.storage.session;
  const ALARM = "myshoppinglist-active-import";
  let sessionGeneration = 0;
  let sessionAbort = new AbortController();
  let syncing;
  async function notifyWebsite() {
    const tabs = await browser.tabs.query({ url: "http://localhost/*" });
    for (const tab of tabs) {
      if (!tab.url || !["http://localhost:3000", "http://localhost:3001"].includes(new URL(tab.url).origin)) continue;
      try { await browser.tabs.sendMessage(tab.id, { type: "myshoppinglist-session-changed" }); } catch { /* Page not loaded yet. */ }
    }
  }
  async function syncSession() {
    if (syncing) return syncing;
    syncing = (async () => {
      const cookie = await browser.cookies.get({ url: WEBSITE_URL, name: SESSION_COOKIE });
      const token = cookie?.path === "/" && /^[a-f0-9]{64}$/.test(cookie.value) ? cookie.value : null;
      const stored = await storage.get("token");
      if ((stored.token || null) === token) return token;
      sessionGeneration++; sessionAbort.abort(); sessionAbort = new AbortController();
      clearTimeout(timer); await browser.alarms.clear(ALARM); await browser.alarms.clear(SHARED_ALARM);
      await closeTab((await storage.get("workflow")).workflow); await closeShared();
      await storage.clear(); if (token) await storage.set({ token });
      await notifyWebsite();
      return token;
    })();
    try { return await syncing; } finally { syncing = null; }
  }
  async function removeSessionCookie(token) {
    const cookie = await browser.cookies.get({ url: WEBSITE_URL, name: SESSION_COOKIE });
    if (cookie?.value === token) await browser.cookies.remove({ url: WEBSITE_URL, name: SESSION_COOKIE });
    await syncSession();
  }
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
  async function request(path, { method = "GET", body, anonymous = false, expectedToken } = {}) {
    const token = await syncSession();
    if (!anonymous && !token) throw new Error("Please sign in to your MyShoppingList account.");
    if (expectedToken && expectedToken !== token) throw new Error("Your account changed. Open the extension again.");
    const version = sessionGeneration;
    const headers = { "Content-Type": "application/json", "X-MyShoppingList-Request": "1", "X-MyShoppingList-Extension": browser.runtime.id,
      "X-Extension-Version": browser.runtime.getManifest?.().version || "unknown",
      "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
    if (!anonymous) headers.Authorization = `Bearer ${token}`;
    const response = await fetcher(`${API_URL}${path}`, { method, headers, credentials: "omit", redirect: "error", cache: "no-store",
      signal: AbortSignal.any([AbortSignal.timeout(20000), sessionAbort.signal]), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    await syncSession();
    if (version !== sessionGeneration) throw new Error("Your account changed. Open the extension again.");
    if (response.status === 401 && !anonymous) await removeSessionCookie(token);
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(response.status === 401 ? "Please sign in again. Check your email and password."
        : response.status === 429 ? "Too many requests. Please wait and try again."
        : response.status >= 500 ? "The server is unavailable. Please try again later."
        : problem.title || "The request could not be completed.");
    }
    const data = response.status === 204 ? null : await response.json();
    await syncSession();
    if (version !== sessionGeneration) throw new Error("Your account changed. Open the extension again.");
    return data;
  }
  async function state() {
    await syncSession();
    const { token, result, workflow } = await storage.get(["token", "result", "workflow"]);
    if (!token) return { session: null, lists: [], result: null, workflow };
    const session = await request("/api/auth/me", { expectedToken: token });
    const lists = await request("/api/shopping-lists", { expectedToken: token });
    const preference = session.account.isTrial ? { enabled: false, blocked: false } : await request("/api/contributions/preference", { expectedToken: token });
    await storage.set({ contributionPreference: preference });
    if (preference.enabled && !preference.blocked) await browser.alarms.create(SHARED_ALARM, { periodInMinutes: 1 });
    else { await browser.alarms.clear(SHARED_ALARM); await closeShared(); }
    return { session, lists, result, workflow, preference };
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
    if (workflow.sessionToken && await syncSession() !== workflow.sessionToken) return;
    safeWork(work); workflow.work = work; workflow.outbox = null;
    if (work.status === "Queued") { await stop(workflow, "Added to the queue. A trusted worker will collect prices; follow progress on your shopping list.", false); return; }
    if (work.status !== "Waiting") {
      await stop(workflow, work.status === "Completed" ? "Product saved. Comparison finished; open your list to see the result."
        : `Product ${work.sourceSaved ? "saved; comparison" : "read"} needs retry (${work.errorCode || "interrupted"}).`, work.status !== "Completed"); return;
    }
    workflow.url = work.url; workflow.kind = work.stage; workflow.status = "Reading";
    workflow.deadline = Date.now() + 90000; workflow.message = work.stage === "search" ? "Product saved. Searching the other retailer…" : "Reading a comparison product…";
    await storage.set({ workflow });
    if (workflow.temporaryTabId == null) {
      const tab = await browser.tabs.create({ url: work.url, active: false });
      if (workflow.sessionToken && await syncSession() !== workflow.sessionToken) { try { await browser.tabs.remove(tab.id); } catch { /* Closed. */ } return; }
      workflow.temporaryTabId = tab.id;
    } else await browser.tabs.update(workflow.temporaryTabId, { url: work.url });
    workflow.tabId = workflow.temporaryTabId; await storage.set({ workflow });
  }
  async function pump() {
    if (pumping || busy) return;
    pumping = true;
    let workflow;
    let version;
    try {
      await syncSession(); version = sessionGeneration;
      workflow = (await storage.get("workflow")).workflow;
      if (!workflow || workflow.status !== "Reading") return;
      if (workflow.sessionToken && workflow.sessionToken !== (await storage.get("token")).token) {
        await closeTab(workflow); await storage.remove("workflow"); return;
      }
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
        await syncSession(); if (version !== sessionGeneration) return;
        if (workflow.kind === "source") {
          if (!result?.ok || !result.evidence) { await stop(workflow, "Could not read this product. Keep its page open, then click Add again."); return; }
          workflow.outbox = { path: "/api/user-extension/imports/", body: { listId: workflow.listId, url: workflow.url, quantity: workflow.quantity, evidence: result.evidence, requestId: workflow.requestId } };
        } else workflow.outbox = { path: `/api/user-extension/imports/${workflow.work.jobId}/result`, body: {
          stepToken: workflow.work.stepToken, url: workflow.url, ok: !!result?.ok, evidence: result?.evidence || null,
          links: result?.links || null, emptyConfirmed: !!result?.emptyConfirmed,
        } };
        await storage.set({ workflow });
      }
      const work = await request(workflow.outbox.path, { method: "POST", body: workflow.outbox.body, expectedToken: workflow.sessionToken });
      if (version !== sessionGeneration) return;
      await next(workflow, work);
      if (workflow.status === "Reading") await schedule();
    } catch (error) {
      if (workflow && version === sessionGeneration) await stop(workflow, `${error.message} Use Retry to resume this import.`);
    } finally { pumping = false; }
  }
  const handle = async function (message) {
    await syncSession();
    const actionToken = (await storage.get("token")).token;
    if (["add", "logout", "contributionPreference", "login"].includes(message.type) && sharing) await new Promise(resolve => sharedWaiters.push(resolve));
    if (message.type === "state") return { ...await state(), busy };
    if (busy || pumping || sharing) throw new Error("A request is already in progress. Please wait.");
    busy = true;
    try {
      if (message.type === "contributionPreference") {
        const enabled = message.enabled === true;
        await storage.set({ contributionPreference: { enabled, blocked: false } });
        if (!enabled) { await browser.alarms.clear(SHARED_ALARM); await closeShared(); }
        await request("/api/contributions/preference", { method: "PUT", body: { enabled }, expectedToken: actionToken });
        return state();
      }
      if (message.type === "login") {
        await closeShared();
        if (typeof message.email !== "string" || typeof message.password !== "string") throw new Error("Enter your email and password.");
        const result = await request("/api/user-extension/login", { method: "POST", anonymous: true, body: { email: message.email, password: message.password } });
        if (!/^[a-f0-9]{64}$/.test(result.token)) throw new Error("The server returned an invalid session.");
        const expires = Date.parse(result.session?.sessionExpiresDate) / 1000;
        if (!Number.isFinite(expires) || expires <= Date.now() / 1000) throw new Error("The server returned an expired session.");
        await browser.cookies.set({ url: WEBSITE_URL, name: SESSION_COOKIE, value: result.token, path: "/", httpOnly: true,
          secure: new URL(WEBSITE_URL).protocol === "https:", sameSite: "lax", expirationDate: expires });
        await syncSession();
        return state();
      }
      if (message.type === "logout") {
        await browser.alarms.clear(SHARED_ALARM); await closeShared();
        clearTimeout(timer); await browser.alarms.clear(ALARM); await closeTab((await storage.get("workflow")).workflow);
        try { await request("/api/auth/logout", { method: "POST", expectedToken: actionToken }); }
        finally { await removeSessionCookie(actionToken); }
        return { session: null, lists: [] };
      }
      if (message.type === "add") {
        await closeShared();
        const previous = (await storage.get("workflow")).workflow;
        if (previous?.status === "Reading") throw new Error("Finish the current import before adding another product.");
        const url = productUrl(message.url);
        if (!url) throw new Error("Open a Coles or Woolworths product page first.");
        if (!Number.isInteger(message.quantity) || message.quantity < 1 || message.quantity > 2147483647) throw new Error("Enter a positive whole-number quantity.");
        const lists = await request("/api/shopping-lists", { expectedToken: actionToken });
        let listId = message.listId;
        if (lists.length === 0) {
          listId = (await request("/api/shopping-lists/default", { method: "POST", expectedToken: actionToken })).shoppingListId;
        } else if (lists.length === 1 && listId == null) listId = lists[0].id;
        if (lists.length && !lists.some(l => l.id === listId)) throw new Error("Choose one of your current shopping lists.");
        const tab = await browser.tabs.get(message.tabId);
        if (productUrl(tab.url) !== url) throw new Error("The product tab changed. Refresh the extension and try again.");
        if (await syncSession() !== actionToken) throw new Error("Your account changed. Open the extension again.");
        const workflow = { status: "Reading", kind: "source", sessionToken: (await storage.get("token")).token, requestId: crypto.randomUUID(), url, listId, quantity: message.quantity, tabId: tab.id,
          temporaryTabId: null, deadline: Date.now() + 90000, message: "Reading the current product…" };
        await closeTab(previous); await storage.set({ workflow }); await schedule();
        return { workflow };
      }
      if (message.type === "retry") {
        const workflow = (await storage.get("workflow")).workflow;
        if (!workflow || workflow.status !== "Failed") throw new Error("There is no failed import to retry.");
        if (workflow.outbox) { workflow.status = "Reading"; await storage.set({ workflow }); }
        else if (workflow.work?.jobId) {
          await next(workflow, await request(`/api/user-extension/imports/${workflow.work.jobId}/retry`, { method: "POST", expectedToken: workflow.sessionToken }));
        } else throw new Error("Open the source product and click Add again.");
        if (workflow.status === "Reading") await schedule();
        return { workflow };
      }
      throw new Error("Unknown action.");
    } finally { busy = false; }
  };
  async function closeShared() {
    clearTimeout(sharedTimer);
    const { sharedTask } = await storage.get("sharedTask");
    if (sharedTask?.tabId != null) try { await browser.tabs.remove(sharedTask.tabId); } catch { /* Already closed. */ }
    await storage.remove("sharedTask");
  }
  function sharedSoon() {
    clearTimeout(sharedTimer); sharedTimer = setTimeout(() => void sharedPump(false), 1000); sharedTimer.unref?.();
  }
  async function sharedPump(allowClaim = true) {
    if (sharing || busy || pumping) return;
    sharing = true;
    let version;
    try {
      await syncSession(); version = sessionGeneration;
      const values = await storage.get(["token", "workflow", "sharedTask", "contributionPreference", "sharedNextCheck"]);
      if (!values.token || values.contributionPreference?.enabled === false || values.contributionPreference?.blocked) {
        await closeShared(); await browser.alarms.clear(SHARED_ALARM); return;
      }
      if (values.workflow?.status === "Reading") return;
      let task = values.sharedTask;
      if (!task) {
        if (!allowClaim || values.sharedNextCheck > Date.now()) return;
        const work = await request("/api/contributions/claim", { method: "POST" });
        await storage.set({ sharedNextCheck: Date.now() + (work ? 60000 : 300000) });
        if (!work) return;
        safeWork({ jobId: work.id, status: "Waiting", stage: work.kind, url: work.url });
        task = { ...work, sessionToken: values.token, deadline: Math.min(Date.now() + 90000, Date.parse(work.leaseExpiresAt)), tabId: null };
        await storage.set({ sharedTask: task });
        const tab = await browser.tabs.create({ url: task.url, active: false });
        await syncSession(); if (version !== sessionGeneration) { try { await browser.tabs.remove(tab.id); } catch { /* Closed. */ } return; }
        task.tabId = tab.id; await storage.set({ sharedTask: task }); sharedSoon(); return;
      }
      let result = { ok: false, code: "read_timeout" };
      if (!task.outbox && Date.now() < task.deadline) {
        let tab;
        try { tab = await browser.tabs.get(task.tabId); } catch { result.code = "tab_closed"; }
        if (tab) {
          if (tab.pendingUrl || tab.status === "loading") { sharedSoon(); return; }
          const same = task.kind === "search" ? tab.url === task.url : productUrl(tab.url) === productUrl(task.url);
          if (same) {
            result = (await browser.scripting.executeScript({ target: { tabId: task.tabId, frameIds: [0] }, files: ["content.js"], world: "ISOLATED", injectImmediately: true }))[0]?.result;
            if (!result || result.code === "product_not_identified" || task.kind === "search" && result.ok && (result.kind !== "search" || result.url !== task.url)) {
              sharedSoon(); return;
            }
          } else result = { ok: false, code: "invalid_product_link" };
        }
      }
      if (!task.outbox) {
        await syncSession(); if (version !== sessionGeneration) return;
        task.outbox = { claimToken: task.claimToken, url: task.url, ok: !!result?.ok, evidence: result?.evidence || null,
          links: result?.links || null, emptyConfirmed: !!result?.emptyConfirmed, errorCode: result?.code || null,
          extensionVersion: browser.runtime.getManifest?.().version || "unknown" };
        await storage.set({ sharedTask: task });
      }
      await request(`/api/contributions/${task.id}/result`, { method: "POST", body: task.outbox, expectedToken: task.sessionToken });
      await closeShared();
      await storage.set({ sharedMessage: "Last shared price check finished." });
    } catch (error) {
      if (version !== sessionGeneration) return;
      await closeShared();
      await storage.set({ sharedNextCheck: Date.now() + 300000, sharedMessage: `Shared collection paused: ${error.message}` });
    } finally { sharing = false; sharedWaiters.splice(0).forEach(resolve => resolve()); }
  }
  async function restore() {
    await syncSession();
    const { token, contributionPreference } = await storage.get(["token", "contributionPreference"]);
    if (token && contributionPreference?.enabled !== false && !contributionPreference?.blocked)
      await browser.alarms.create(SHARED_ALARM, { periodInMinutes: 1 });
  }
  return Object.assign(handle, { pump, sharedPump, restore, syncSession });
}

if (typeof document === "undefined" && typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  const handle = createWorker(chrome);
  void handle.restore();
  let cookieTimer;
  chrome.cookies.onChanged.addListener(change => {
    if (change.cookie.name !== SESSION_COOKIE || change.cookie.domain !== new URL(WEBSITE_URL).hostname || change.cookie.path !== "/") return;
    clearTimeout(cookieTimer);
    cookieTimer = setTimeout(() => { void handle.restore(); }, 100);
  });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "myshoppinglist-active-import") void handle.pump(); else if (alarm.name === "myshoppinglist-shared-prices") void handle.sharedPump(); });
  chrome.tabs.onUpdated.addListener(() => { void handle.pump(); void handle.sharedPump(false); });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
    handle(message).then(data => respond({ ok: true, data }), error => respond({ ok: false,
      error: error.name === "TimeoutError" ? "Request timed out. An add may already have succeeded; check your list before trying again."
        : error instanceof TypeError ? "Cannot connect to localhost:5392. Check that the API is running." : error.message }));
    return true;
  });
}
