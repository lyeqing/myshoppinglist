// Private comparison work is issued by the API only after a committed retailer save.
// Keep credentials and replayable result receipts out of the extension views.
export function createPersonalComparisonController(browser, worker, { productUrl, sameProductUrl, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
  const storage = browser.storage.session;
  const path = "/api/user-extension/comparisons";
  let running = false;
  let activeQueue;
  let stopped = 0;
  async function session() {
    const token = await worker.syncSession();
    const { personalComparisons: stored } = await storage.get("personalComparisons");
    if (activeQueue?.token !== token) activeQueue = stored?.token === token ? stored : { token, jobs: [] };
    return { token, queue: activeQueue };
  }
  async function check(token, version) {
    if (await worker.syncSession() !== token || stopped !== version) throw new Error("Comparison interrupted. Your saved product was kept.");
  }
  async function store(queue) {
    if (await worker.syncSession() === queue.token) await storage.set({ personalComparisons: queue });
  }
  async function request(queue, suffix, body) {
    return worker.request(path + suffix, { expectedToken: queue.token, ...(body === undefined ? {} : { method: "POST", body }) });
  }
  function allowed(work, value) {
    try {
      const actual = new URL(value), expected = new URL(work.url);
      if (actual.origin !== expected.origin || actual.username || actual.password || actual.port) return false;
      if (work.kind === "product") return sameProductUrl ? sameProductUrl(value, work.url) : productUrl(value) === productUrl(work.url);
      const key = work.retailer === "woolworths" ? "searchTerm" : "q";
      return actual.pathname === expected.pathname && actual.searchParams.get(key) === expected.searchParams.get(key);
    } catch { return false; }
  }
  async function close(job) {
    const id = job.tabId; job.tabId = null;
    if (Number.isInteger(id)) try { await browser.tabs.remove(id); } catch { /* Already closed. */ }
  }
  async function read(queue, job, work, version) {
    const searchPaths = { coles: "/search/products", woolworths: "/shop/search/products", aldi: "/results" };
    if (!["coles", "woolworths", "aldi"].includes(work.retailer) || !["search", "product"].includes(work.kind)
      || new URL(work.url).origin !== `https://www.${work.retailer}.com.au`
      || (work.kind === "product" ? !productUrl(work.url) : new URL(work.url).pathname !== searchPaths[work.retailer]))
      throw new Error("The comparison requested an unsupported retailer page.");
    let tab;
    if (job.tabId != null) try { tab = await browser.tabs.get(job.tabId); } catch { job.tabId = null; }
    await check(queue.token, version);
    if (!tab) {
      tab = await browser.tabs.create({ url: work.url, active: false });
      job.tabId = tab.id; await store(queue);
    } else if (!allowed(work, tab.url) || tab.pendingUrl) {
      await browser.tabs.update(tab.id, { url: work.url, active: false });
    }
    for (let attempt = 0; attempt < 40; attempt++) {
      await check(queue.token, version);
      const current = await browser.tabs.get(tab.id);
      if (current.pendingUrl && !allowed(work, current.pendingUrl) || !current.pendingUrl && !allowed(work, current.url))
        return { stepToken: work.stepToken, url: work.url, ok: false, errorCode: "page_changed" };
      if (current.status === "complete" && !current.pendingUrl) {
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        const frames = await browser.scripting.executeScript({ target: { tabId: tab.id },
          func: () => globalThis.ColesReader.read(document, location.href) });
        const result = frames[0]?.result;
        await check(queue.token, version);
        const after = await browser.tabs.get(tab.id);
        if (!allowed(work, after.url) || after.pendingUrl) return { stepToken: work.stepToken, url: work.url, ok: false, errorCode: "page_changed" };
        if (result?.ok) {
          if (work.kind === "search" && (result.kind !== "search" || !Array.isArray(result.links) || result.links.length > 5)
            || work.kind === "product" && (!result.evidence || result.kind === "search"))
            return { stepToken: work.stepToken, url: work.url, ok: false, errorCode: "invalid_page" };
          return { stepToken: work.stepToken, url: work.url, ok: true, observedAt: new Date().toISOString(),
            ...(work.kind === "search" ? { links: result.links, emptyConfirmed: !!result.emptyConfirmed } : { evidence: result.evidence }) };
        }
        if (result?.code === "retailer_access_restricted")
          return { stepToken: work.stepToken, url: work.url, ok: false, errorCode: "retailer_access_restricted" };
      }
      await pause(500);
    }
    return { stepToken: work.stepToken, url: work.url, ok: false, errorCode: "page_timeout" };
  }
  async function pump() {
    if (running) return;
    running = true;
    const version = stopped;
    let queue;
    try {
      ({ queue } = await session());
      if (!queue.token || queue.jobs.some(j => j.paused && j.tabId != null)) return;
      for (const job of queue.jobs) {
        if (job.paused || ["Completed", "Partial", "Cancelled", "Unavailable"].includes(job.response?.status)) continue;
        try {
          if (!job.id) {
            job.response = await request(queue, "", { captureJobId: job.jobId }); job.id = job.response.id;
            if (job.cancelRequested) job.response = await request(queue, `/${job.id}/cancel`, {});
            await store(queue); await check(queue.token, version);
          }
          // A stored receipt is replayed before reading another page.
          while (job.pending || job.response?.work) {
            await check(queue.token, version);
            if (!job.pending) {
              try { job.pending = await read(queue, job, job.response.work, version); }
              catch {
                await check(queue.token, version);
                job.pending = { stepToken: job.response.work.stepToken, url: job.response.work.url, ok: false, errorCode: "page_unavailable" };
              }
              await store(queue);
            }
            try { const response = await request(queue, `/${job.id}/result`, job.pending); await check(queue.token, version); job.response = response; }
            catch (error) {
              if (error.status === 400 && job.pending.ok) {
                job.pending = { stepToken: job.pending.stepToken, url: job.pending.url, ok: false, errorCode: "invalid_evidence" };
                await store(queue); continue;
              }
              if (error.status === 409) { job.response = await request(queue, `/${job.id}`); job.pending = null; }
              else throw error;
            }
            job.pending = null;
            if (job.response.status === "Paused") { job.paused = true; await store(queue); break; }
            await store(queue);
          }
          if (!job.paused) { await close(job); await store(queue); }
        } catch (error) {
          if (await worker.syncSession() !== queue.token || stopped !== version) break;
          if ([404, 409].includes(error.status)) {
            job.pending = null; job.paused = false;
            job.response = { ...job.response, status: "Unavailable", work: null };
            job.error = "Checks stopped because the saved item is no longer available or eligible.";
            await close(job);
          } else {
            job.paused = true; job.error = "Your product is saved. Checks were interrupted. Resume to continue safely.";
          }
          await store(queue);
        }
      }
    } finally {
      running = false;
      if (queue?.token && await worker.syncSession() !== queue.token)
        for (const job of queue.jobs) await close(job);
      if (stopped !== version) void pump();
    }
  }
  async function enqueue(jobId) {
    const { queue } = await session();
    if (!queue.jobs.some(j => j.jobId === jobId)) queue.jobs.push({ jobId, id: null, response: null, paused: false, tabId: null });
    await store(queue); void pump();
  }
  async function snapshot() {
    const { queue } = await session();
    return queue.jobs.map(j => ({ jobId: j.jobId, id: j.id, response: j.response,
      paused: !!j.paused, error: j.error || null }));
  }
  async function action(message) {
    if (message.action === "resume") {
      const { queue } = await session();
      const job = queue.jobs.find(j => j.jobId === message.jobId);
      if (!job) throw new Error("This comparison is no longer available in this browser session.");
      if (running) throw new Error("Wait for the current retailer check to finish.");
      if (job.id && !job.pending) job.response = await request(queue, `/${job.id}`);
      job.paused = false; job.error = null; await store(queue); void pump();
    } else if (message.action === "open") {
      const { queue } = await session(); const job = queue.jobs.find(j => j.jobId === message.jobId);
      if (!job?.response?.work || !job.paused) throw new Error("No retailer verification is waiting.");
      const tab = await browser.tabs.get(job.tabId);
      if (!allowed(job.response.work, tab.url)) throw new Error("The retailer page changed. Resume checks to reopen it.");
      await browser.tabs.update(tab.id, { active: true });
    } else if (["cancel", "retry"].includes(message.action)) {
      // Fence in-flight extraction before changing server state. The server step
      // token also rejects a late result that races with cancellation.
      stopped++;
      const { queue } = await session(); const job = queue.jobs.find(j => j.jobId === message.jobId);
      if (!job) throw new Error("This comparison is no longer available.");
      if (job.id) job.response = await request(queue, `/${job.id}/${message.action}`, {});
      else job.response = message.action === "cancel" ? { status: "Cancelled", retailers: [], work: null } : null;
      job.pending = null; job.error = null; job.paused = message.action === "cancel";
      job.cancelRequested = message.action === "cancel";
      await close(job); await store(queue);
      // The current pump may still be unwinding; its finally schedules the next one.
      void pump();
    }
    return { comparisons: await snapshot() };
  }
  async function recover() {
    const { queue } = await session();
    for (const job of queue.jobs) if (job.id && !job.paused) {
      try { job.response = await request(queue, `/${job.id}`); } catch { job.paused = true; }
    }
    if (queue.token) {
      try {
        for (const response of await request(queue, "/pending"))
          if (!queue.jobs.some(j => j.id === response.id)) queue.jobs.push({ jobId: response.captureJobId,
            id: response.id, response, paused: true, tabId: null, error: ["Checking", "Paused"].includes(response.status) ? "Your product is saved. Resume checks to continue." : null });
      } catch { /* Capture remains usable while comparisons are unavailable. */ }
    }
    await store(queue); void pump();
  }
  async function reset() {
    stopped++;
    const previous = activeQueue; activeQueue = undefined;
    for (const job of previous?.jobs || []) await close(job);
  }
  return { enqueue, snapshot, action, recover, pump, reset };
}
