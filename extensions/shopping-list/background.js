export const API_URL = "http://localhost:5392";
export const WEBSITE_URL = "http://localhost:3000/";
const SESSION_COOKIE = "myshoppinglist_session";

export function retailerPage(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["coles.com.au", "woolworths.com.au", "aldi.com.au"].includes(
        url.hostname.replace(/^www\./, ""),
      )
    );
  } catch {
    return false;
  }
}

export function preferredList(lists, remembered, defaultId) {
  return (
    lists.find((list) => list.id === remembered) ??
    lists.find((list) => list.id === defaultId) ??
    [...lists].sort((a, b) => a.id - b.id)[0] ??
    null
  );
}

export function productUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      (host === "coles.com.au" &&
        /^\/product\/(?:(?:[a-z0-9.'+-]|%27|%2b)+-)?\d{1,15}\/?$/i.test(
          url.pathname,
        )) ||
      (host === "aldi.com.au" && /^\/product\/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?-\d{1,20}\/?$/i.test(url.pathname)) ||
      (host === "woolworths.com.au" &&
        /^\/shop\/productdetails\/\d{1,15}(?:\/[a-z0-9%.'_-]+)?\/?$/i.test(
          url.pathname,
        ))
    ) {
      return `https://www.${host}${url.pathname.replace(/\/$/, "")}`;
    }
  } catch {
    /* Unsupported tab. */
  }
  return null;
}

export function sameProductUrl(left, right) {
  const identity = (value) => {
    const canonical = productUrl(value);
    if (!canonical) return null;
    const url = new URL(canonical);
    // Retailers may add or change a descriptive slug without changing the
    // product. Keep retailer boundaries and the complete product code intact.
    const code = url.hostname === "www.woolworths.com.au"
      ? url.pathname.match(/^\/shop\/productdetails\/(\d+)/)?.[1]
      : url.pathname.match(/(\d+)$/)?.[1];
    return code ? `${url.hostname}:${code}` : null;
  };
  const expected = identity(right);
  return expected !== null && identity(left) === expected;
}

export async function attachWebsiteBridges(browser) {
  for (const tab of await browser.tabs.query({ url: "http://localhost/*" })) {
    try {
      if (!["http://localhost:3000", "http://localhost:3001"].includes(new URL(tab.url).origin)) continue;
      let connected;
      try { connected = await browser.tabs.sendMessage(tab.id, { type: "website-bridge-ping" }); } catch { /* No active bridge. */ }
      if (connected?.version !== 2)
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["website-session.js"] });
    } catch { /* Closed or navigating tabs receive the manifest script on their next load. */ }
  }
}

export function createWorker(browser, fetcher = fetch) {
  const storage = browser.storage.session;
  let generation = 0;
  let sessionAbort = new AbortController();
  let syncing;
  let busy = false;
  const changed = () => new Error("Your account changed. Read the product again.");
  async function syncSession() {
    if (syncing) return syncing;
    syncing = (async () => {
      const cookie = await browser.cookies.get({ url: WEBSITE_URL, name: SESSION_COOKIE });
      const token = cookie?.path === "/" && /^[a-f0-9]{64}$/.test(cookie.value) ? cookie.value : null;
      const previous = await storage.get("token");
      const initial = !Object.hasOwn(previous, "token");
      if ((previous.token || null) === token) {
        if (initial) await storage.set({ token });
        return token;
      }
      generation++;
      sessionAbort.abort();
      sessionAbort = new AbortController();
      const { panelUi } = await storage.get("panelUi");
      await storage.clear();
      await storage.set({ token, ...(panelUi ? { panelUi } : {}) });
      // Recovering the same website cookie after an extension reload is not a
      // website account change. Avoid resetting open editors during reconnect.
      for (const tab of initial ? [] : await browser.tabs.query({ url: "http://localhost/*" })) {
        try {
          if (["http://localhost:3000", "http://localhost:3001"].includes(new URL(tab.url).origin))
            await browser.tabs.sendMessage(tab.id, { type: "myshoppinglist-session-changed" });
        } catch { /* The website may not be loaded. */ }
      }
      return token;
    })();
    try { return await syncing; } finally { syncing = null; }
  }
  async function removeCookie(token) {
    const cookie = await browser.cookies.get({ url: WEBSITE_URL, name: SESSION_COOKIE });
    if (cookie?.value === token) await browser.cookies.remove({ url: WEBSITE_URL, name: SESSION_COOKIE });
    await syncSession();
  }
  async function request(path, { method = "GET", body, anonymous = false, expectedToken, signal } = {}) {
    const token = await syncSession();
    if (!anonymous && !token) throw new Error("Please sign in to MyShoppingList.");
    if (expectedToken && expectedToken !== token) throw changed();
    const version = generation;
    const response = await fetcher(API_URL + path, {
      method, credentials: "omit", redirect: "error", cache: "no-store",
      headers: {
        "Content-Type": "application/json", "X-MyShoppingList-Request": "1",
        "X-MyShoppingList-Extension": browser.runtime.id,
        "X-Extension-Version": browser.runtime.getManifest?.().version || "unknown",
        "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        ...(!anonymous ? { Authorization: "Bearer " + token } : {}),
      },
      signal: AbortSignal.any([AbortSignal.timeout(20000), sessionAbort.signal, ...(signal ? [signal] : [])]),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    await syncSession();
    if (version !== generation) throw changed();
    if (response.status === 401 && !anonymous) await removeCookie(token);
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      const error = new Error(response.status === 401 ? "Please sign in again."
        : response.status === 429 ? "Too many requests. Wait a moment, then retry."
        : problem.title || "The server is unavailable. Please try again.");
      error.status = response.status;
      throw error;
    }
    const data = response.status === 204 ? null : await response.json();
    await syncSession();
    if (version !== generation) throw changed();
    return data;
  }
  async function check(token) {
    if ((await syncSession()) !== token) throw changed();
  }
  async function view() {
    const { review, pending, workflow } = await storage.get(["review", "pending", "workflow"]);
    return {
      review: review?.summary ?? null,
      pending: !!pending,
      quantity: pending?.body.quantity ?? null,
      workflow: workflow ? { status: workflow.status, message: workflow.message } : null,
    };
  }
  async function state() {
    const token = await syncSession();
    if (!token) return { session: null, lists: [], ...(await view()) };
    const session = await request("/api/auth/me", { expectedToken: token });
    const lists = await request("/api/shopping-lists", { expectedToken: token });
    const selected = preferredList(lists, (await storage.get("selectedListId")).selectedListId, session.shoppingListId);
    await check(token);
    await storage.set({ selectedListId: selected?.id ?? null });
    return { session, lists, selectedListId: selected?.id ?? null, ...(await view()) };
  }
  async function productTab(tabId, expectedUrl) {
    const tab = await browser.tabs.get(tabId);
    const url = productUrl(tab.url);
    if (!tab.active || tab.pendingUrl || !url || (expectedUrl && url !== expectedUrl))
      throw new Error("Return to the same product page, then read it again.");
    return { tab, url };
  }
  async function submit(token) {
    const { pending } = await storage.get("pending");
    if (!pending || pending.token !== token) throw new Error("There is no saved request to retry.");
    await storage.set({ workflow: { status: "Saving", message: "Saving to your list…" } });
    try {
      const saved = await request("/api/user-extension/captures", {
        method: "POST", body: pending.body, expectedToken: token,
      });
      if (!saved || !Number.isSafeInteger(saved.productId) || !Number.isSafeInteger(saved.shoppingListProductId)
          || saved.status !== "Completed") throw new Error("The save response was incomplete.");
      await check(token);
      await storage.set({ pending: null, review: null, workflow: {
        status: "Completed", message: saved.priceSaved
          ? (saved.alreadyOnList ? "Product is on your list. Its quantity has been updated." : "Product saved to your list.")
          : "Product saved to your list without a verified price.",
      } });
    } catch (error) {
      await syncSession();
      if ((await storage.get("token")).token === token) {
        // A timeout, lost reply or server failure can follow a committed save.
        // Keep the exact receipt request until the user explicitly retries it.
        const definitive = [400, 403, 404, 409, 410, 413].includes(error.status);
        await storage.set({
          ...(definitive ? { pending: null } : {}),
          workflow: { status: definitive ? "Failed" : "Pending",
            message: definitive ? error.message
              : error.message + " The outcome is not confirmed. Retry this save safely using the same request." },
        });
      }
      throw error;
    }
    return view();
  }
  async function handle(message) {
    if (message.type === "state") return state();
    if (busy) throw new Error("Please wait for the current action.");
    busy = true;
    try {
      const token = await syncSession();
      if (message.type === "login") {
        const result = await request("/api/user-extension/login", {
          method: "POST", anonymous: true, body: { email: message.email, password: message.password },
        });
        const expires = Date.parse(result.session?.sessionExpiresDate) / 1000;
        if (!/^[a-f0-9]{64}$/.test(result.token) || !Number.isFinite(expires) || expires <= Date.now() / 1000)
          throw new Error("The server returned an invalid sign-in response.");
        await browser.cookies.set({ url: WEBSITE_URL, name: SESSION_COOKIE, value: result.token,
          path: "/", httpOnly: true, secure: WEBSITE_URL.startsWith("https:"), sameSite: "lax", expirationDate: expires });
        await syncSession();
        return state();
      }
      if (message.type === "logout") {
        try { if (token) await request("/api/auth/logout", { method: "POST", expectedToken: token }); }
        finally { await removeCookie(token); }
        return state();
      }
      if (!token) throw new Error("Please sign in to MyShoppingList.");
      const { pending } = await storage.get("pending");
      if (message.type === "retry") return await submit(token);
      if (pending) throw new Error("Retry the unconfirmed save before starting another product.");
      if (message.type === "selectList") {
        const data = await state();
        if (!data.lists.some((list) => list.id === message.listId)) throw new Error("Choose one of your shopping lists.");
        await check(token);
        await storage.set({ selectedListId: message.listId });
        return { selectedListId: message.listId };
      }
      if (message.type === "cancel") {
        await storage.set({ review: null, workflow: null });
        return view();
      }
      if (message.type === "preview") {
        await storage.set({ review: null, workflow: null });
        const { url } = await productTab(message.tabId);
        const observedAt = new Date().toISOString();
        await browser.scripting.executeScript({ target: { tabId: message.tabId }, files: ["content.js"] });
        const frames = await browser.scripting.executeScript({ target: { tabId: message.tabId },
          func: () => globalThis.ColesReader.read(document, location.href) });
        const extracted = frames[0]?.result;
        if (!extracted?.ok || !extracted.evidence) throw new Error("This product could not be read. Check the product page and try again.");
        await productTab(message.tabId, url);
        const summary = await request("/api/user-extension/captures/preview", {
          method: "POST", expectedToken: token, body: { url, evidence: extracted.evidence, observedAt },
        });
        if (!summary?.name || productUrl(summary.url) !== url || !Number.isFinite(Date.parse(summary.observedAt))
            || (summary.price != null && (!Number.isFinite(summary.price) || summary.price < 0)))
          throw new Error("The product preview could not be validated. Read the page again.");
        await productTab(message.tabId, url);
        await check(token);
        await storage.set({ review: { token, tabId: message.tabId, url, observedAt, evidence: extracted.evidence, summary },
          workflow: { status: "Review", message: "Review this product, then save it to your list." } });
        return view();
      }
      if (message.type === "save") {
        const { review } = await storage.get("review");
        if (!review || review.token !== token || review.tabId !== message.tabId)
          throw new Error("Read the current product before saving.");
        await productTab(message.tabId, review.url);
        if (!Number.isInteger(message.quantity) || message.quantity < 1 || message.quantity > 2147483647)
          throw new Error("Enter a positive whole-number quantity.");
        const data = await state();
        const selectedId = message.listId ?? data.selectedListId;
        let list = data.lists.find((item) => item.id === selectedId);
        if (data.lists.length && !list) throw new Error("Choose one of your shopping lists.");
        if (!list) list = await request("/api/shopping-lists/default", { method: "POST", expectedToken: token });
        if (!Number.isSafeInteger(list?.id)) throw new Error("Your shopping list could not be selected.");
        await productTab(message.tabId, review.url);
        await check(token);
        await storage.set({ selectedListId: list.id, pending: { token, body: {
          listId: list.id, quantity: message.quantity, url: review.url, evidence: review.evidence,
          observedAt: review.observedAt, requestId: crypto.randomUUID(),
        } } });
        return await submit(token);
      }
      throw new Error("Unsupported extension action.");
    } finally { busy = false; }
  }
  handle.syncSession = syncSession;
  handle.request = request;
  handle.restore = async () => {
    // Remove only tabs explicitly owned by the retired worker, never source tabs.
    const old = await storage.get(["workflow", "sharedTask", "priceRefreshTab"]);
    for (const id of new Set([old.workflow?.temporaryTabId, old.sharedTask?.tabId, old.priceRefreshTab].filter(Number.isInteger))) {
      try { await browser.tabs.remove(id); } catch { /* Already closed. */ }
    }
    await storage.remove(["sharedTask", "contributionPreference", "priceRefreshTab"]);
    if (old.workflow?.temporaryTabId != null || old.workflow?.sessionToken) await storage.remove("workflow");
    return syncSession();
  };
  return handle;
}
// The website drives one bounded read at a time, so a suspended worker never
// silently reports an unfinished batch as completed. Credentials stay here.
export function createRefreshController(browser, worker) {
  let run = null;
  let busy = false;
  const cancelled = new Set();
  const snapshot = () => ({ runId: run.id, total: run.targets.length, completed: run.index,
    updated: run.updated, failed: run.failed, message: run.message,
    failures: run.failures.map(f => ({ ...f })), pending: run.targets.slice(run.index).map(t => ({ ...t })),
    done: run.index === run.targets.length });
  async function sameAccount(accountId) {
    const session = await worker.request("/api/auth/me");
    if (session.account?.id !== accountId) throw new Error("Your account changed. Refresh the website and try again.");
  }
  async function validRun(message) {
    if (!run || run.id !== message.runId || run.accountId !== message.accountId
        || (await worker.syncSession()) !== run.token)
      throw new Error("This refresh has ended. Start Refresh items again.");
  }
  return async (message) => {
    if (message.action === "hello") return { available: true, version: 2,
      ...(browser.runtime?.id ? { extensionId: browser.runtime.id } : {}) };
    if (message.action === "cancel") {
      if (typeof message.runId !== "string" || !/^[a-f0-9-]{36}$/i.test(message.runId))
        throw new Error("Invalid refresh request.");
      cancelled.add(message.runId);
      if (cancelled.size > 32) cancelled.delete(cancelled.values().next().value);
      if (run?.id === message.runId && run.accountId === message.accountId) {
        run.abort.abort();
        run = null;
      }
      return { cancelled: true };
    }
    if (busy) throw new Error("Another price update is still finishing. Try again shortly.");
    busy = true;
    try {
      if (message.action === "start") {
        if (!Number.isSafeInteger(message.listId) || message.listId <= 0
            || !Number.isSafeInteger(message.accountId) || typeof message.runId !== "string"
            || !/^[a-f0-9-]{36}$/i.test(message.runId)) throw new Error("Invalid refresh request.");
        if (message.targets !== undefined && (!Array.isArray(message.targets) || !message.targets.length
            || message.targets.length > 5000 || message.targets.some(t => !t || !Number.isSafeInteger(t.itemId)
              || t.itemId <= 0 || !Number.isSafeInteger(t.mappingId) || t.mappingId <= 0)))
          throw new Error("Choose the products to retry from your refresh results.");
        await sameAccount(message.accountId);
        const token = await worker.syncSession();
        if (run?.websiteTabId != null) {
          try { await browser.tabs.get(run.websiteTabId); }
          catch { run.abort.abort(); run = null; }
        }
        if (run && (run.token !== token || run.websiteTabId === message.websiteTabId)) {
          run.abort.abort();
          run = null;
        }
        if (run && !run.abort.signal.aborted && run.index < run.targets.length)
          throw new Error("A price refresh is already running in another website tab. Finish or cancel it first.");
        let targets = await worker.request(`/api/user-extension/price-refresh/${message.listId}`, { expectedToken: token });
        if (!Array.isArray(targets) || targets.some(t => !productUrl(t.url)
            || !Number.isSafeInteger(t.itemId) || !Number.isSafeInteger(t.mappingId)))
          throw new Error("The product list could not be validated.");
        if (message.targets) {
          const selected = new Set(message.targets.map(t => `${t.itemId}:${t.mappingId}`));
          targets = targets.filter(t => selected.has(`${t.itemId}:${t.mappingId}`));
        }
        if (cancelled.has(message.runId)) throw new Error("Refresh cancelled.");
        run = { id: message.runId, accountId: message.accountId, listId: message.listId, token,
          websiteTabId: message.websiteTabId,
          targets, index: 0, updated: 0, failed: 0, failures: [], message: "", abort: new AbortController() };
        return snapshot();
      }
      if (message.action !== "next") throw new Error("Unsupported refresh action.");
      await validRun(message);
      if (run.index === run.targets.length) return snapshot();
      const active = run;
      const target = active.targets[active.index];
      let tabId;
      try {
        const tab = await browser.tabs.create({ url: productUrl(target.url), active: false });
        tabId = tab.id;
        await browser.storage.session.set({ priceRefreshTab: tabId });
        const signal = AbortSignal.any([active.abort.signal, AbortSignal.timeout(20000)]);
        let reachedProduct = false;
        const check = async () => {
          signal.throwIfAborted();
          if (run !== active || await worker.syncSession() !== active.token)
            throw new Error("Your account changed. Start a new refresh.");
          const current = await browser.tabs.get(tabId);
          if (current.pendingUrl && !sameProductUrl(current.pendingUrl, target.url))
            throw new Error("The retailer redirected this product. Open its page to check it.");
          if (!sameProductUrl(current.url, target.url)) {
            // A newly created Chrome tab can still be blank while its initial
            // navigation is pending. It is not a retailer redirect.
            if (!reachedProduct && (!current.url || current.url === "about:blank")
                && (current.status === "loading" || sameProductUrl(current.pendingUrl, target.url)))
              return { ...current, status: "loading" };
            throw new Error("The retailer redirected this product. Open its page to check it.");
          }
          reachedProduct = true;
          return current;
        };
        let extracted;
        let observedAt;
        // Product data can arrive after document load. Bound the wait and never
        // interact with verification challenges or execute retailer page scripts.
        while (!extracted?.ok) {
          const current = await check();
          if (current.status === "complete") {
            observedAt = new Date().toISOString();
            await browser.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
            const frames = await browser.scripting.executeScript({ target: { tabId },
              func: () => globalThis.ColesReader.read(document, location.href) });
            extracted = frames[0]?.result;
          }
          if (!extracted?.ok) await new Promise(resolve => setTimeout(resolve, 500));
        }
        await check();
        const result = await worker.request("/api/user-extension/price-refresh", {
          method: "POST", expectedToken: active.token, signal: active.abort.signal,
          body: { listId: active.listId, itemId: target.itemId, mappingId: target.mappingId,
            evidence: extracted.evidence, observedAt } });
        if (run !== active) throw new Error("Refresh cancelled.");
        if (result.updated) active.updated++; else active.failed++;
        active.message = `${target.name}: ${result.message}`;
        if (!result.updated) active.failures.push({ ...target, message: result.message });
      } catch (error) {
        if (run !== active || active.abort.signal.aborted) throw new Error("Refresh cancelled.");
        if (await worker.syncSession() !== active.token || error.status === 401) {
          run = null;
          throw new Error("Your session changed. Sign in and start a new refresh.");
        }
        if ([403, 429, 503].includes(error.status)) { run = null; throw error; }
        active.failed++;
        const reason = error.name === "TimeoutError"
          ? "Could not read this page. Open it to check for retailer verification, then try again."
          : error.message;
        active.message = `${target.name}: ${reason}`;
        active.failures.push({ ...target, message: reason });
      } finally {
        if (tabId != null) {
          try { await browser.tabs.remove(tabId); } catch { /* User already closed our tab. */ }
          await browser.storage.session.remove("priceRefreshTab");
        }
      }
      active.index++;
      return snapshot();
    } finally { busy = false; }
  };
}

export function createPanelController(browser, worker) {
  const storage = browser.storage.session;
  let serial = Promise.resolve();
  const run = (fn) => {
    const result = serial.then(fn);
    serial = result.catch(() => {});
    return result;
  };
  const read = async () =>
    (await storage.get("panelUi")).panelUi ?? {
      opened: false,
      hidden: true,
      fullTabId: null,
      tickets: {},
    };
  async function close(tabId) {
    if (tabId == null) return;
    let windowId;
    try {
      windowId = (await browser.tabs.get(tabId)).windowId;
    } catch {
      windowId = (await read()).fullWindowId;
    }
    try {
      await browser.sidePanel.close({ tabId });
    } catch {
      /* Already closed. */
    }
    // The first toolbar opening uses the manifest's global panel. Since Chrome
    // 145, closing by tabId alone does not close that window-level panel.
    if (windowId != null) {
      try {
        await browser.sidePanel.close({ windowId });
      } catch {
        /* No global panel is open in this window. */
      }
    }
  }
  async function notify() {
    for (const tab of await browser.tabs.query({})) {
      if (retailerPage(tab.url))
        await browser.tabs
          .sendMessage(tab.id, { type: "panel-changed" })
          .catch(() => {});
    }
  }
  async function visible(tabId) {
    await worker.syncSession();
    const tab = await browser.tabs.get(tabId);
    const ui = await read();
    const { token, workflow, sharedTask } = await storage.get([
      "token",
      "workflow",
      "sharedTask",
    ]);
    const ownTaskTab =
      tabId === workflow?.temporaryTabId || tabId === sharedTask?.tabId;
    const show =
      !!token &&
      ui.opened &&
      !ui.hidden &&
      ui.fullTabId !== tabId &&
      retailerPage(tab.url) &&
      !ownTaskTab;
    if (show && !ui.tickets[tabId]) {
      ui.tickets[tabId] = crypto.randomUUID();
      await storage.set({ panelUi: ui });
    }
    if (show)
      await browser.sidePanel.setOptions({
        tabId,
        path: `popup.html?tabId=${tabId}`,
        enabled: true,
      });
    return { show, ticket: show ? ui.tickets[tabId] : null, tabId };
  }
  async function full(tab, alreadyOpened = false) {
    await browser.sidePanel.setOptions({
      tabId: tab.id,
      path: `popup.html?tabId=${tab.id}`,
      enabled: true,
    });
    if (!alreadyOpened) await browser.sidePanel.open({ tabId: tab.id });
    const ui = await read();
    const previous = ui.fullTabId;
    ui.opened = true;
    ui.hidden = false;
    ui.fullTabId = tab.id;
    ui.fullWindowId = tab.windowId;
    ui.fullUrl = tab.url;
    await storage.set({ panelUi: ui });
    if (previous !== tab.id) await close(previous);
    await notify();
  }
  return {
    toolbar: async (tab, alreadyOpened = false) => {
      const ui = await read();
      const { token } = await storage.get("token");
      if (alreadyOpened || !ui.opened || !token || !retailerPage(tab.url))
        return full(tab, alreadyOpened);
      return run(async () => {
        const state = await read();
        const previous = state.fullTabId;
        state.hidden = false;
        state.fullTabId = null;
        await storage.set({ panelUi: state });
        await close(previous);
        // Existing retailer tabs may predate the extension reload.
        await browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["retailer-panel.js"],
        });
        await notify();
      });
    },
    full,
    visible: (tabId) => run(() => visible(tabId)),
    minimize: (tabId) =>
      run(async () => {
        const tab = await browser.tabs.get(tabId);
        await worker.syncSession();
        if (!retailerPage(tab.url) || !(await storage.get("token")).token)
          throw new Error("Sign in on a Coles, Woolworths or ALDI page to minimize.");
        const ui = await read();
        ui.fullTabId = null;
        ui.hidden = false;
        await storage.set({ panelUi: ui });
        await close(tabId);
        await browser.scripting.executeScript({
          target: { tabId },
          files: ["retailer-panel.js"],
        });
        await notify();
      }),
    hide: () =>
      run(async () => {
        const ui = await read();
        const previous = ui.fullTabId;
        ui.hidden = true;
        ui.fullTabId = null;
        ui.tickets = {};
        await storage.set({ panelUi: ui });
        await close(previous);
        await notify();
      }),
    navigation: (tabId, url, activated = false) =>
      run(async () => {
        const ui = await read();
        if (
          ui.fullTabId != null &&
          (activated
            ? ui.fullTabId !== tabId
            : ui.fullTabId === tabId && ui.fullUrl !== url)
        ) {
          const previous = ui.fullTabId;
          ui.fullTabId = null;
          await storage.set({ panelUi: ui });
          await close(previous);
        }
        await notify();
      }),
    closed: (tabId, windowId) =>
      run(async () => {
        const ui = await read();
        if (
          ui.fullTabId != null &&
          (ui.fullTabId === tabId ||
            (tabId == null && ui.fullWindowId === windowId))
        ) {
          ui.fullTabId = null;
          ui.hidden = true;
          ui.tickets = {};
          await storage.set({ panelUi: ui });
          await notify();
        }
      }),
    notify,
    authorizedCompact: async (sender) => {
      if (!sender.tab || !sender.frameId) return false;
      try {
        const url = new URL(sender.url);
        if (
          url.protocol !== "chrome-extension:" ||
          url.host !== browser.runtime.id ||
          url.pathname !== "/compact.html"
        )
          return false;
        const value = await visible(sender.tab.id);
        return value.show && value.ticket === url.searchParams.get("ticket");
      } catch {
        return false;
      }
    },
  };
}

if (
  typeof document === "undefined" &&
  typeof chrome !== "undefined" &&
  chrome.runtime?.onMessage
) {
  const handle = createWorker(chrome);
  const refresh = createRefreshController(chrome, handle);
  const panels = createPanelController(chrome, handle);
  // Updating an extension invalidates scripts in already-open tabs. Reconnect
  // without reloading the user's page or starting price collection.
  void attachWebsiteBridges(chrome).catch(() => {});
  chrome.runtime.onInstalled?.addListener(() => { void attachWebsiteBridges(chrome).catch(() => {}); });
  chrome.runtime.onStartup?.addListener(() => { void attachWebsiteBridges(chrome).catch(() => {}); });
  let toolbarState = {};
  void chrome.storage.session.get(["panelUi", "token"]).then((value) => {
    toolbarState = value;
  });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  chrome.action.onClicked.addListener((tab) => {
    const openFull =
      !toolbarState.panelUi?.opened ||
      !toolbarState.token ||
      !retailerPage(tab.url);
    // Invoke directly in the click handler: asynchronous session checks lose Chrome's gesture.
    const opened = openFull
      ? chrome.sidePanel.open({ tabId: tab.id })
      : Promise.resolve();
    void opened
      .then(() => panels.toolbar(tab, openFull))
      .catch((error) => console.error("Panel could not open:", error.message));
  });
  chrome.sidePanel.onClosed.addListener((info) => {
    void panels.closed(info.tabId, info.windowId);
  });
  chrome.tabs.onActivated.addListener((info) => {
    void panels.navigation(info.tabId, null, true);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session")
      for (const key of ["panelUi", "token"])
        if (changes[key]) toolbarState[key] = changes[key].newValue;
    if (area === "session" && changes.token) void panels.notify();
  });
  void handle.restore();
  let cookieTimer;
  chrome.cookies.onChanged.addListener((change) => {
    if (
      change.cookie.name !== SESSION_COOKIE ||
      change.cookie.domain !== new URL(WEBSITE_URL).hostname ||
      change.cookie.path !== "/"
    )
      return;
    clearTimeout(cookieTimer);
    cookieTimer = setTimeout(() => {
      void handle.restore();
    }, 100);
  });
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url) void panels.navigation(tabId, tab.url);
  });
  chrome.runtime.onMessageExternal?.addListener((message, sender, respond) => {
    let origin;
    try { origin = new URL(sender.url).origin; } catch { return false; }
    if (sender.id || !sender.tab || sender.frameId != null && sender.frameId !== 0
        || !["http://localhost:3000", "http://localhost:3001"].includes(origin)
        || message?.type !== "website-price-refresh") return false;
    refresh({ ...message, websiteTabId: sender.tab.id }).then(data => respond({ ok: true, data }),
      error => respond({ ok: false, error: error.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    const source = new URL(sender.url || chrome.runtime.getURL("/"));
    if (sender.tab && sender.frameId === 0
        && ["http://localhost:3000", "http://localhost:3001"].includes(source.origin)
        && message.type === "website-price-refresh") {
      refresh({ ...message, websiteTabId: sender.tab.id }).then(data => respond({ ok: true, data }),
        error => respond({ ok: false, error: error.message }));
      return true;
    }
    const extensionPage =
      source.protocol === "chrome-extension:" &&
      source.host === chrome.runtime.id;
    const fullPage =
      extensionPage && source.pathname === "/popup.html" && !sender.tab;
    const compactPage = extensionPage && source.pathname === "/compact.html";
    const retailerScript =
      sender.frameId === 0 && sender.tab && retailerPage(sender.url);
    if (
      !fullPage &&
      !compactPage &&
      !(retailerScript && message.type === "panel-state")
    )
      return false;
    (async () => {
      if (retailerScript) return panels.visible(sender.tab.id);
      if (compactPage && !(await panels.authorizedCompact(sender)))
        throw new Error("Open the extension from its toolbar icon.");
      const tabId = compactPage
        ? sender.tab.id
        : source.searchParams.has("tabId")
          ? Number(source.searchParams.get("tabId"))
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
              ?.id;
      if (message.type === "panel-hide") return panels.hide();
      if (message.type === "panel-minimize" && fullPage)
        return panels.minimize(tabId);
      if (message.type === "panel-expand" && compactPage)
        return panels.full(await chrome.tabs.get(tabId), true);
      if (compactPage && !["state", "preview", "save", "retry", "cancel", "selectList"].includes(message.type))
        throw new Error("Unsupported compact-view action.");
      const data = await handle({ ...message, tabId });
      data.tabId = tabId;
      try { data.productUrl = productUrl((await chrome.tabs.get(tabId)).url); }
      catch { data.productUrl = null; }
      return data;
    })().then(
      (data) => respond({ ok: true, data }),
      (error) =>
        respond({
          ok: false,
          error:
            error.name === "TimeoutError"
              ? "Request timed out. If saving, use Retry save to check the same request safely."
              : error instanceof TypeError
                ? "Cannot connect to localhost:5392. Check that the API is running."
                : error.message,
        }),
    );
    return true;
  });
}
