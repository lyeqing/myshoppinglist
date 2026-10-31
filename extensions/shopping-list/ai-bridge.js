// Only the background worker calls this module. Device secrets and page evidence
// remain in session storage and are never sent to an extension view.
export function createExtensionBridge(browser, worker, { apiUrl, productUrl, sameProductUrl,
  fetcher = fetch, pause = (ms) => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const storage = browser.storage.session;
  const version = browser.runtime.getManifest().version;
  const retailers = ["coles", "woolworths", "aldi"];
  const terminal = new Set(["completed", "cancelled", "failed", "expired"]);
  let busy = false;
  async function identity() {
    const token = await worker.syncSession();
    if (!token) throw new Error("Sign in to MyShoppingList first.");
    return token;
  }
  async function check(token) {
    if (await worker.syncSession() !== token) throw new Error("Your account changed. Reopen AI requests.");
  }
  async function deviceRequest(path, { method = "GET", body } = {}) {
    const token = await identity();
    const { aiDevice: device } = await storage.get("aiDevice");
    if (!device || device.forToken !== token) throw new Error("Link this extension first.");
    const response = await fetcher(apiUrl + "/api/extension-device" + path, {
      method, credentials: "omit", redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-MyShoppingList-Request": "1",
        "X-MyShoppingList-Extension": browser.runtime.id, "X-MyShoppingList-Device": device.deviceId,
        Authorization: "Bearer " + device.deviceToken },
      signal: AbortSignal.timeout(20000), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    await check(token);
    if (!response.ok) {
      if (response.status === 401) await storage.remove(["aiDevice", "aiActive"]);
      const problem = await response.json().catch(() => ({}));
      throw new Error(problem.title || "The extension request could not be completed. Refresh to check its status.");
    }
    const result = response.status === 204 ? null : await response.json();
    await check(token);
    return result;
  }
  async function capabilities() {
    const allowed = [];
    for (const code of retailers)
      if (await browser.permissions.contains({ origins: [`https://www.${code}.com.au/*`] })) allowed.push(code);
    return allowed;
  }
  async function snapshot(interactive = true) {
    const token = await worker.syncSession();
    if (!token) return { signedIn: false, tasks: [] };
    const account = await worker.request("/api/auth/me", { expectedToken: token });
    const info = await worker.request("/api/user-extension/bridge-info", { expectedToken: token });
    const { aiDevice: device } = await storage.get("aiDevice");
    const base = { signedIn: true, account: account.account, enabled: info.enabled, feedbackEnabled: info.feedbackEnabled, linked: !!device, tasks: [] };
    if (!info.enabled || !device) return base;
    await deviceRequest("/heartbeat", { method: "POST", body: { extensionVersion: version,
      protocolVersion: 1, supportedRetailers: await capabilities(), interactive } });
    const tasks = interactive ? await deviceRequest("/tasks") : [];
    let { aiActive: active, aiOutcome: outcome } = await storage.get(["aiActive", "aiOutcome"]);
    if (active) {
      const latest = await deviceRequest(`/tasks/${active.task.id}`);
      if (terminal.has(latest.status)) {
        outcome = latest; active = null;
        await storage.set({ aiActive: null, aiOutcome: outcome });
      } else active.task = latest;
    }
    return { ...base, tasks, outcome, active: active ? { task: active.task, review: active.review || null,
      canSave: !!active.body, needsResume: !active.body } : null };
  }
  function approvedUrl(task, value) {
    if (task.type === "capture") return sameProductUrl(task.url, value);
    try {
      const url = new URL(value), expected = new URL(task.url);
      return url.origin === expected.origin && url.pathname === expected.pathname
        && url.search === expected.search && !url.username && !url.password && !url.port;
    } catch { return false; }
  }
  async function currentTab(id, task, token, loading = false) {
    await check(token);
    const tab = await browser.tabs.get(id);
    const expectedNavigation = loading && tab.pendingUrl && approvedUrl(task, tab.pendingUrl);
    if (!tab.active || !expectedNavigation && (tab.pendingUrl || !approvedUrl(task, tab.url)))
      throw new Error("The approved page changed or is no longer active. Resume when ready.");
    return tab;
  }
  async function readApproved(active, sourceTabId, token) {
    const task = active.task;
    if (!retailers.includes(task.retailer) || !(await capabilities()).includes(task.retailer)
        || task.type === "capture" && !productUrl(task.url)
        || !["capture", "search"].includes(task.type)) throw new Error("Allow this retailer in the extension settings before continuing.");
    // All URLs originate from the validated server task, never from a message URL.
    const tab = await browser.tabs.create({ url: task.url, active: true });
    active.tabId = tab.id;
    await check(token); await storage.set({ aiActive: active });
    let extracted;
    for (let attempt = 0; attempt < 12; attempt++) {
      const current = await currentTab(tab.id, task, token, true);
      if (current.status === "complete" && !current.pendingUrl) {
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        const frames = await browser.scripting.executeScript({ target: { tabId: tab.id },
          func: () => globalThis.ColesReader.read(document, location.href) });
        extracted = frames[0]?.result;
        await currentTab(tab.id, task, token);
        if (extracted?.ok || extracted?.code === "retailer_access_restricted") break;
      }
      await pause(750);
    }
    if (extracted?.code === "retailer_access_restricted") {
      const outcome = await deviceRequest(`/tasks/${task.id}/fail`, { method: "POST",
        body: { claimToken: active.claimToken, errorCode: "retailer_blocked" } });
      await storage.set({ aiOutcome: outcome, aiActive: null });
      throw new Error("The retailer restricted access. This request has stopped; no product was saved.");
    }
    if (!extracted?.ok) throw new Error("This page could not be read. Check the retailer page, then Resume or Cancel.");
    const observedAt = new Date().toISOString();
    if (task.type === "capture") {
      if (!extracted.evidence || extracted.kind === "search") throw new Error("The approved product could not be identified.");
      active.body = { claimToken: active.claimToken, evidence: extracted.evidence, observedAt };
      active.review = await deviceRequest(`/tasks/${task.id}/preview`, { method: "POST", body: active.body });
    } else {
      if (extracted.kind !== "search" || !Array.isArray(extracted.links) || extracted.links.length > 5
          || !extracted.links.length && !extracted.emptyConfirmed) throw new Error("Search results are not ready. Resume to try again.");
      const candidates = extracted.links.map(url => ({ url, name: null }));
      if (candidates.some(c => !productUrl(c.url) || new URL(c.url).hostname !== new URL(task.url).hostname))
        throw new Error("The search contained an unsupported product link.");
      active.body = { claimToken: active.claimToken, candidates, emptyConfirmed: !!extracted.emptyConfirmed, observedAt };
      active.review = { candidates, emptyConfirmed: !!extracted.emptyConfirmed, observedAt };
    }
    await currentTab(tab.id, task, token);
    await storage.set({ aiActive: active });
    // Focus the review only while the tab opened for this request is still active.
    await browser.tabs.update(sourceTabId, { active: true });
  }
  return async function handle(message, sourceTabId) {
    if (busy) throw new Error("Wait for the current request to finish.");
    busy = true;
    try {
      if (message.type === "ai-state") return await snapshot(message.interactive !== false);
      const token = await identity();
      if (message.type === "ai-feedback") {
        await worker.request("/api/feedback", { method: "POST", expectedToken: token, body: {
          expectedAccountId: message.expectedAccountId, requestId: message.requestId, category: message.category,
          message: message.message, rating: null, component: "extension", screenshotApproved: false,
        } });
        return { ...await snapshot(), feedbackReceived: true };
      } else if (message.type === "ai-link") {
        const info = await worker.request("/api/user-extension/bridge-info", { expectedToken: token });
        if (!info.enabled) throw new Error("AI requests are not enabled on this server.");
        const session = await worker.request("/api/auth/me", { expectedToken: token });
        if (!session.account?.id || session.account.isTrial) throw new Error("Create a registered MyShoppingList account first.");
        let { aiInstallationId: installationId } = await browser.storage.local.get("aiInstallationId");
        if (!installationId) { installationId = crypto.randomUUID(); await browser.storage.local.set({ aiInstallationId: installationId }); }
        const credentials = await worker.request("/api/user-extension/devices", { method: "POST", expectedToken: token,
          body: { expectedAccountId: session.account.id, installationId, extensionVersion: version, protocolVersion: 1 } });
        await check(token);
        await storage.set({ aiDevice: { ...credentials, forToken: token }, aiActive: null, aiOutcome: null });
      } else if (message.type === "ai-unlink") {
        await deviceRequest("/self", { method: "DELETE" });
        await storage.remove(["aiDevice", "aiActive", "aiOutcome"]);
      } else {
        const { aiActive: existing } = await storage.get("aiActive");
        if (message.type === "ai-approve" || message.type === "ai-decline") {
          if (existing && existing.task.id !== message.taskId) throw new Error("Finish or cancel your current request first.");
          if (!/^[a-f0-9-]{36}$/i.test(message.taskId || "")) throw new Error("Choose a pending request.");
          const result = await deviceRequest(`/tasks/${message.taskId}/decision`, { method: "POST", body: { approve: message.type === "ai-approve" } });
          if (message.type === "ai-approve" && result.claimToken) {
            const active = { task: result.task, claimToken: result.claimToken };
            await storage.set({ aiActive: active });
            active.task = await deviceRequest(`/tasks/${result.task.id}/start`, { method: "POST", body: { claimToken: active.claimToken } });
            await storage.set({ aiActive: active });
            await readApproved(active, sourceTabId, token);
          }
        } else if (message.type === "ai-save" || message.type === "ai-cancel") {
          if (!existing) throw new Error("Refresh to find the request.");
          if (message.type === "ai-save" && !existing.body) throw new Error("Resume and review this request before saving.");
          const outcome = await deviceRequest(`/tasks/${existing.task.id}/${message.type === "ai-save" ? existing.task.type : "cancel"}`,
            { method: "POST", body: message.type === "ai-save" ? existing.body : { claimToken: existing.claimToken, errorCode: "user_declined" } });
          await storage.set({ aiOutcome: outcome, aiActive: null });
        } else throw new Error("Unsupported AI request action.");
      }
      return await snapshot();
    } finally { busy = false; }
  };
}
