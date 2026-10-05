import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../background.js", import.meta.url),
  "utf8",
);
const {
  productUrl,
  createWorker,
  createPanelController,
  retailerPage,
  preferredList,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const token = "a".repeat(64);
function fixture(lists = [{ id: 1, name: "One" }]) {
  let data = { token };
  let cookie = {
    value: token,
    name: "myshoppinglist_session",
    path: "/",
    domain: "localhost",
    httpOnly: true,
  };
  const calls = [];
  const removed = [];
  const tabs = new Map([
    [7, { id: 7, url: "https://www.coles.com.au/product/test-123" }],
  ]);
  const browser = {
    runtime: { id: "a".repeat(32) },
    cookies: {
      get: async () => (cookie ? structuredClone(cookie) : null),
      set: async (value) => {
        cookie = { ...value, domain: "localhost" };
        return cookie;
      },
      remove: async () => {
        cookie = null;
      },
    },
    alarms: { create: async () => {}, clear: async () => {} },
    tabs: {
      query: async () => [],
      sendMessage: async () => {},
      get: async (id) => {
        if (!tabs.has(id)) throw new Error("closed");
        return tabs.get(id);
      },
      create: async ({ url }) => {
        const tab = { id: 100, url };
        tabs.set(100, tab);
        return tab;
      },
      update: async (id, value) => {
        Object.assign(tabs.get(id), value);
      },
      remove: async (id) => {
        removed.push(id);
        tabs.delete(id);
      },
    },
    scripting: {
      executeScript: async () => [
        {
          result: { ok: true, evidence: { nextProductJson: "{}", jsonLd: [] } },
        },
      ],
    },
    storage: {
      session: {
        get: async () => structuredClone(data),
        set: async (value) => {
          Object.assign(data, structuredClone(value));
        },
        remove: async (key) => {
          delete data[key];
        },
        clear: async () => {
          data = {};
        },
      },
    },
  };
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    const value = url.endsWith("user-extension/login")
      ? {
          token,
          session: {
            account: { id: 1 },
            sessionExpiresDate: new Date(Date.now() + 86400000).toISOString(),
          },
        }
      : url.endsWith("/me")
        ? { account: { id: 1 } }
        : url.endsWith("/shopping-lists")
          ? lists
          : url.endsWith("/default")
            ? { shoppingListId: 3 }
            : url.endsWith("/preference")
              ? { enabled: true, blocked: false }
              : {
                  jobId: 10,
                  status: "Completed",
                  sourceSaved: true,
                  stage: "complete",
                };
    return { ok: true, status: 200, json: async () => value };
  };
  return {
    handle: createWorker(browser, fetcher),
    fetcher,
    browser,
    calls,
    removed,
    data: () => data,
  };
}
const url = "https://www.coles.com.au/product/test-123";
test("stale product identity retries once in a background tab and saves the selected product", async () => {
  for (const product of [
    url,
    "https://www.woolworths.com.au/shop/productdetails/456",
  ]) {
    const f = fixture();
    await f.browser.tabs.update(7, { url: product });
    const created = [];
    const create = f.browser.tabs.create;
    f.browser.tabs.create = async (options) => {
      created.push(options);
      return create(options);
    };
    f.browser.scripting.executeScript = async ({ target }) => [
      {
        result:
          target.tabId === 7
            ? { ok: false, code: "product_identity_conflict" }
            : {
                ok: true,
                evidence: { nextProductJson: "fresh selected product" },
              },
      },
    ];
    await f.handle({
      type: "add",
      url: product,
      tabId: 7,
      quantity: 2,
      listId: 1,
    });
    const requestId = f.data().workflow.requestId;
    await f.handle.pump();
    assert.deepEqual(created, [{ url: product, active: false }]);
    assert.equal(
      f.calls.some((call) => call.url.endsWith("/imports/")),
      false,
    );
    await f.handle.pump();
    const submitted = JSON.parse(
      f.calls.find((call) => call.url.endsWith("/imports/")).body,
    );
    assert.equal(submitted.url, product);
    assert.equal(submitted.requestId, requestId);
    assert.equal(submitted.quantity, 2);
    assert.equal(submitted.evidence.nextProductJson, "fresh selected product");
    assert.equal(f.data().workflow.status, "Completed");
    assert.deepEqual(f.removed, [100]);
    assert.equal((await f.browser.tabs.get(7)).url, product);
  }
});
test("repeated identity conflict fails safely and closes the retry tab without submitting", async () => {
  const f = fixture();
  let created = 0;
  const create = f.browser.tabs.create;
  f.browser.tabs.create = async (options) => {
    created++;
    return create(options);
  };
  f.browser.scripting.executeScript = async () => [
    { result: { ok: false, code: "product_identity_conflict" } },
  ];
  await f.handle({ type: "add", url, tabId: 7, quantity: 1, listId: 1 });
  await f.handle.pump();
  await f.handle.pump();
  await f.handle.pump();
  assert.equal(created, 1);
  assert.equal(f.data().workflow.status, "Failed");
  assert.deepEqual(f.removed, [100]);
  assert.equal(
    f.calls.some((call) => call.url.endsWith("/imports/")),
    false,
  );
});
test("navigating away after Add does not retry a different product", async () => {
  const f = fixture();
  await f.handle({ type: "add", url, tabId: 7, quantity: 1, listId: 1 });
  await f.browser.tabs.update(7, {
    url: "https://www.coles.com.au/product/other-456",
  });
  await f.handle.pump();
  assert.equal(f.data().workflow.status, "Failed");
  assert.equal(f.data().workflow.sourceReloadAttempted, undefined);
  assert.deepEqual(f.removed, []);
  assert.equal(
    f.calls.some((call) => call.url.endsWith("/imports/")),
    false,
  );
});
test("fresh-document retry closes its tab on timeout or sign-out", async () => {
  for (const reason of ["timeout", "signout"]) {
    const f = fixture();
    f.browser.scripting.executeScript = async () => [
      { result: { ok: false, code: "product_identity_conflict" } },
    ];
    await f.handle({ type: "add", url, tabId: 7, quantity: 1, listId: 1 });
    await f.handle.pump();
    if (reason === "timeout") {
      await f.browser.storage.session.set({
        workflow: { ...f.data().workflow, deadline: 0 },
      });
      await f.handle.pump();
      assert.equal(f.data().workflow.status, "Failed");
    } else {
      await f.browser.cookies.remove();
      await f.handle.syncSession();
      assert.equal(f.data().workflow, undefined);
    }
    assert.deepEqual(f.removed, [100]);
    assert.equal((await f.browser.tabs.get(7)).url, url);
    assert.equal(
      f.calls.some((call) => call.url.endsWith("/imports/")),
      false,
    );
  }
});
function panelFixture() {
  const f = fixture();
  const opened = [],
    closed = [];
  f.browser.runtime.getURL = (path) =>
    `chrome-extension://${f.browser.runtime.id}/${path}`;
  f.browser.sidePanel = {
    setOptions: async () => {},
    open: async (value) => opened.push(value.tabId),
    close: async (value) => closed.push(value.tabId),
  };
  return {
    ...f,
    opened,
    closed,
    panels: createPanelController(f.browser, f.handle),
  };
}
test("Hide closes the first global panel and later tab-specific panels, including after worker restart", async () => {
  const f = panelFixture();
  await f.browser.tabs.update(7, { windowId: 11, url: "chrome://newtab/" });
  const tab = await f.browser.tabs.get(7);
  let globalOpen = true;
  let tabOpen = false;
  const closes = [];
  f.browser.sidePanel.close = async (options) => {
    closes.push(options);
    if (options.tabId != null) {
      if (!tabOpen) throw new Error("No tab-specific panel is open");
      tabOpen = false;
    } else {
      assert.equal(options.windowId, 11);
      globalOpen = false;
    }
  };
  await f.panels.toolbar(tab, true);
  const restored = createPanelController(f.browser, f.handle);
  await restored.hide();
  assert.equal(globalOpen, false);
  assert.deepEqual(closes, [{ tabId: 7 }, { windowId: 11 }]);
  assert.equal(f.data().panelUi.hidden, true);
  tabOpen = true;
  await restored.toolbar(tab, true);
  await restored.hide();
  assert.equal(tabOpen, false);
  assert.equal(f.data().panelUi.hidden, true);
});
test("Chrome closing a global panel remembers Hide only for the owning window", async () => {
  const f = panelFixture();
  await f.browser.tabs.update(7, { windowId: 11 });
  await f.panels.toolbar(await f.browser.tabs.get(7), true);
  await f.panels.closed(undefined, 12);
  assert.equal(f.data().panelUi.hidden, false);
  await f.panels.closed(undefined, 11);
  assert.equal(f.data().panelUi.hidden, true);
  await f.panels.navigation(7, url);
  assert.equal((await f.panels.visible(7)).show, false);
});
test("first open is full, minimize is compact, and Hide survives navigation and worker restart", async () => {
  const f = panelFixture();
  const tab = await f.browser.tabs.get(7);
  assert.equal((await f.panels.visible(7)).show, false);
  await f.panels.toolbar(tab);
  assert.deepEqual(f.opened, [7]);
  assert.equal((await f.panels.visible(7)).show, false);
  await f.panels.minimize(7);
  assert.equal((await f.panels.visible(7)).show, true);
  await f.panels.hide();
  const restored = createPanelController(f.browser, f.handle);
  await restored.navigation(7, tab.url);
  assert.equal((await restored.visible(7)).show, false);
  await restored.toolbar(tab);
  assert.equal((await restored.visible(7)).show, true);
  assert.deepEqual(f.opened, [7]);
  await f.browser.storage.session.clear();
  await restored.toolbar(tab);
  assert.deepEqual(f.opened, [7, 7]);
});
test("navigation closes full view; unrelated pages and signed-out sessions cannot minimize", async () => {
  const f = panelFixture();
  const tab = await f.browser.tabs.get(7);
  await f.panels.toolbar(tab);
  await f.browser.tabs.update(7, { url: "https://example.com/" });
  await f.panels.navigation(7, "https://example.com/");
  assert.deepEqual(f.closed, [7]);
  assert.equal((await f.panels.visible(7)).show, false);
  await f.panels.toolbar(tab);
  assert.equal(f.opened.length, 2);
  await assert.rejects(f.panels.minimize(7), /Sign in/);
  await f.browser.tabs.update(7, { url });
  await f.browser.cookies.remove();
  await assert.rejects(f.panels.minimize(7), /Sign in/);
  assert.equal((await f.panels.visible(7)).show, false);
});
test("compact frame authorization requires the current per-tab ticket and visible authenticated UI", async () => {
  const f = panelFixture();
  await f.panels.toolbar(await f.browser.tabs.get(7));
  await f.panels.minimize(7);
  const state = await f.panels.visible(7);
  const sender = {
    tab: { id: 7 },
    frameId: 1,
    url: f.browser.runtime.getURL(`compact.html?ticket=${state.ticket}`),
  };
  assert.equal(await f.panels.authorizedCompact(sender), true);
  assert.equal(
    await f.panels.authorizedCompact({ ...sender, frameId: 0 }),
    false,
  );
  assert.equal(
    await f.panels.authorizedCompact({
      ...sender,
      url: sender.url.replace(state.ticket, "invalid"),
    }),
    false,
  );
  assert.equal(
    await f.panels.authorizedCompact({
      ...sender,
      url: sender.url.replace(f.browser.runtime.id, "b".repeat(32)),
    }),
    false,
  );
  await f.panels.hide();
  assert.equal(await f.panels.authorizedCompact(sender), false);
});
test("compact Add remembers owned selection, falls back when deleted, and creates a list when empty", async () => {
  const f = fixture([{ id: 1 }, { id: 2 }]);
  await f.handle({ type: "selectList", listId: 2 });
  await f.handle({ type: "add", compact: true, url, tabId: 7, quantity: 3 });
  assert.equal(f.data().workflow.listId, 2);
  assert.equal(f.data().workflow.quantity, 3);
  await f.handle.pump();
  await assert.rejects(f.handle({ type: "selectList", listId: 99 }), /Choose/);
  await f.browser.storage.session.set({ selectedListId: 99 });
  await f.handle({ type: "add", compact: true, url, tabId: 7, quantity: 1 });
  assert.equal(f.data().workflow.listId, 1);
  const empty = fixture([]);
  await empty.handle({
    type: "add",
    compact: true,
    url,
    tabId: 7,
    quantity: 1,
  });
  assert.equal(empty.data().workflow.listId, 3);
  assert.equal(preferredList([{ id: 1 }, { id: 2 }], 99, 2).id, 2);
});
test("retailer eligibility includes search pages but rejects spoofed and insecure origins", () => {
  assert.equal(
    retailerPage("https://www.coles.com.au/search/products?q=milk"),
    true,
  );
  assert.equal(retailerPage("https://www.woolworths.com.au/"), true);
  for (const value of [
    "https://coles.com.au.evil.test/",
    "http://www.coles.com.au/",
    "https://x@www.coles.com.au/",
    "chrome://extensions",
  ])
    assert.equal(retailerPage(value), false);
});
test("valid product URLs canonicalize; unrelated and misleading hosts fail", () => {
  assert.equal(productUrl(url + "?pid=tracking#fragment"), url);
  assert.ok(productUrl("https://www.coles.com.au/product/four'n-twenty-123"));
  assert.ok(
    productUrl("https://www.woolworths.com.au/shop/productdetails/123/name"),
  );
  for (const value of [
    "https://evil.com/product/test-123",
    "https://coles.com.au.evil.com/product/test-123",
    "http://coles.com.au/product/test-123",
    "https://www.coles.com.au/search/products?q=test",
    "https://x@www.coles.com.au/product/test-123",
    "chrome://extensions",
  ])
    assert.equal(productUrl(value), null);
});
test("adds to chosen owned list with bearer token, without cookies", async () => {
  const f = fixture([{ id: 1 }, { id: 2 }]);
  await f.handle({ type: "add", url, tabId: 7, quantity: 2, listId: 2 });
  await f.handle.pump();
  assert.equal(f.data().workflow.work.jobId, 10);
  const call = f.calls.at(-1);
  assert.match(call.url, /user-extension\/imports\/$/);
  assert.equal(call.credentials, "omit");
  assert.equal(call.headers.Authorization, `Bearer ${token}`);
  assert.equal(JSON.parse(call.body).listId, 2);
  assert.equal(JSON.parse(call.body).url, url);
  assert.equal(JSON.parse(call.body).quantity, 2);
  assert.ok(JSON.parse(call.body).evidence);
  assert.deepEqual(f.removed, []);
});
test("creates default only with no lists, and rejects unowned or missing selection", async () => {
  const empty = fixture([]);
  await empty.handle({ type: "add", url, tabId: 7, quantity: 2, listId: null });
  await empty.handle.pump();
  assert.equal(empty.calls.filter((c) => c.url.endsWith("/default")).length, 1);
  assert.equal(JSON.parse(empty.calls.at(-1).body).listId, 3);
  const multi = fixture([{ id: 1 }, { id: 2 }]);
  await assert.rejects(
    multi.handle({ type: "add", url, quantity: 2, listId: 99 }),
    /Choose/,
  );
  await assert.rejects(
    multi.handle({ type: "add", url, quantity: 2, listId: null }),
    /Choose/,
  );
  assert.equal(multi.calls.filter((c) => c.method === "POST").length, 0);
});
test("login stores only token, state never returns token and logout clears it", async () => {
  const f = fixture();
  await f.browser.storage.session.clear();
  await f.handle({
    type: "login",
    email: "a@example.test",
    password: "secret",
  });
  assert.deepEqual(f.data(), {
    token,
    selectedListId: 1,
    contributionPreference: { enabled: true, blocked: false },
  });
  assert.equal(f.calls[0].headers.Authorization, undefined);
  assert.equal((await f.handle({ type: "state" })).token, undefined);
  await f.handle({ type: "logout" });
  assert.deepEqual(f.data(), {});
});
test("unauthorized API clears token and invalid quantities cannot submit", async () => {
  const f = fixture();
  await assert.rejects(f.handle({ type: "add", url, quantity: 0 }), /positive/);
  const handle = createWorker(f.browser, async () => ({
    status: 401,
    ok: false,
    json: async () => ({}),
  }));
  await assert.rejects(handle({ type: "state" }), /sign in/);
  assert.deepEqual(f.data(), {});
});

test("comparison uses one owned tab, resumes its own work, closes it and never polls unrelated tasks", async () => {
  const f = fixture();
  const searchUrl =
    "https://www.woolworths.com.au/shop/search/products?searchTerm=test";
  const candidate = "https://www.woolworths.com.au/shop/productdetails/123";
  let results = 0;
  const response = (data) => ({
    ok: true,
    status: 200,
    json: async () => data,
  });
  const fetcher = async (address, options) => {
    if (address.endsWith("/imports/"))
      return response({
        jobId: 20,
        status: "Waiting",
        sourceSaved: true,
        stage: "search",
        stepToken: "search",
        url: searchUrl,
      });
    if (address.endsWith("/result")) {
      results++;
      assert.equal(
        JSON.parse(options.body).stepToken,
        results === 1 ? "search" : "product",
      );
      return response(
        results === 1
          ? {
              jobId: 20,
              status: "Waiting",
              sourceSaved: true,
              stage: "product",
              stepToken: "product",
              url: candidate,
            }
          : {
              jobId: 20,
              status: "Completed",
              sourceSaved: true,
              stage: "complete",
            },
      );
    }
    return f.fetcher(address, options);
  };
  f.browser.scripting.executeScript = async ({ target }) => [
    {
      result:
        target.tabId === 7
          ? { ok: true, evidence: {} }
          : results === 0
            ? { ok: true, kind: "search", url: searchUrl, links: [candidate] }
            : { ok: true, evidence: {} },
    },
  ];
  const handle = createWorker(f.browser, fetcher);
  await handle({ type: "add", url, tabId: 7, quantity: 2, listId: 1 });
  await handle.pump();
  assert.equal(f.data().workflow.temporaryTabId, 100);
  await handle.pump();
  await handle.pump();
  assert.equal(f.data().workflow.status, "Completed");
  assert.deepEqual(f.removed, [100]);
  assert.equal((await f.browser.tabs.get(7)).url, url);
  const before = f.calls.length;
  await handle.pump();
  assert.equal(f.calls.length, before);
  assert.equal(results, 2);
  assert.ok(f.calls.every((c) => !c.url.includes("coles-worker")));
});

test("lost response keeps identical outbox and request ID for retry", async () => {
  const f = fixture();
  let first = true;
  const bodies = [];
  const handle = createWorker(f.browser, async (address, options) => {
    if (address.endsWith("/imports/")) {
      bodies.push(options.body);
      if (first) {
        first = false;
        throw new TypeError("Connection lost");
      }
    }
    return f.fetcher(address, options);
  });
  await handle({ type: "add", url, tabId: 7, quantity: 2, listId: 1 });
  await handle.pump();
  assert.equal(f.data().workflow.status, "Failed");
  await handle({ type: "retry" });
  await handle.pump();
  assert.equal(f.data().workflow.status, "Completed");
  assert.equal(bodies[0], bodies[1]);
});

test("comparison read failure closes only the temporary tab", async () => {
  const f = fixture();
  const handle = createWorker(f.browser, async (address, options) => {
    if (address.endsWith("/imports/"))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobId: 5,
          status: "Waiting",
          stage: "product",
          stepToken: "p",
          url: "https://www.woolworths.com.au/shop/productdetails/123",
        }),
      };
    if (address.endsWith("/result")) {
      assert.equal(JSON.parse(options.body).ok, false);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobId: 5,
          status: "Failed",
          sourceSaved: true,
          errorCode: "read_failed",
        }),
      };
    }
    return f.fetcher(address, options);
  });
  await handle({ type: "add", url, tabId: 7, quantity: 2, listId: 1 });
  await handle.pump();
  f.browser.scripting.executeScript = async () => [
    { result: { ok: false, code: "access_restricted" } },
  ];
  await handle.pump();
  assert.deepEqual(f.removed, [100]);
  assert.equal(f.data().workflow.status, "Failed");
});

test("idle sharing claims only one task, survives worker suspension, submits and closes its own tab", async () => {
  const f = fixture();
  const calls = [];
  const fetcher = async (address, options) => {
    calls.push({ address, options });
    if (address.endsWith("/claim"))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 50,
          kind: "product",
          url,
          claimToken: "reserved",
          leaseExpiresAt: new Date(Date.now() + 180000).toISOString(),
        }),
      };
    return { ok: true, status: 204 };
  };
  await createWorker(f.browser, fetcher).sharedPump();
  assert.equal(f.data().sharedTask.id, 50);
  await createWorker(f.browser, fetcher).sharedPump();
  assert.equal(calls.filter((c) => c.address.endsWith("/claim")).length, 1);
  assert.equal(JSON.parse(calls[1].options.body).claimToken, "reserved");
  assert.equal(JSON.parse(calls[1].options.body).ok, true);
  assert.deepEqual(f.removed, [100]);
  assert.equal(f.data().sharedTask, undefined);
  assert.equal((await f.browser.tabs.get(7)).url, url);
});

test("opt-out and active personal work do not claim; Add preempts a reserved shared tab", async () => {
  const f = fixture();
  await f.browser.storage.session.set({
    contributionPreference: { enabled: false },
  });
  await f.handle.sharedPump();
  assert.equal(f.calls.length, 0);
  await f.browser.storage.session.set({
    contributionPreference: { enabled: true },
    workflow: { status: "Reading" },
  });
  await f.handle.sharedPump();
  assert.equal(f.calls.length, 0);
  await f.browser.storage.session.remove("workflow");
  await f.browser.tabs.create({ url });
  await f.browser.storage.session.set({ sharedTask: { id: 12, tabId: 100 } });
  await f.handle({ type: "add", url, tabId: 7, quantity: 1, listId: 1 });
  assert.deepEqual(f.removed, [100]);
  assert.equal(f.data().workflow.kind, "source");
  assert.equal(f.data().sharedTask, undefined);
});

test("no shared work backs off and signed-out browsers do not contact the server", async () => {
  const f = fixture();
  let calls = 0;
  const handle = createWorker(f.browser, async () => {
    calls++;
    return { ok: true, status: 200, json: async () => null };
  });
  await handle.sharedPump();
  await handle.sharedPump();
  assert.equal(calls, 1);
  await f.browser.cookies.remove();
  await f.browser.storage.session.clear();
  await handle.sharedPump();
  assert.equal(calls, 1);
});

test("unsupported shared task URL never opens a tab", async () => {
  const f = fixture();
  const handle = createWorker(f.browser, async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: 1,
      kind: "product",
      url: "https://evil.example/product/1",
    }),
  }));
  await handle.sharedPump();
  assert.equal(f.data().sharedTask, undefined);
  await assert.rejects(f.browser.tabs.get(100));
});

test("website session survives extension storage loss and sign-out removes the shared cookie", async () => {
  const f = fixture();
  await f.browser.storage.session.clear();
  const state = await f.handle({ type: "state" });
  assert.equal(state.session.account.id, 1);
  assert.equal(f.data().token, token);
  assert.equal(
    f.calls.some((c) => c.url.endsWith("/login")),
    false,
  );
  await f.handle({ type: "logout" });
  assert.equal(await f.browser.cookies.get(), null);
  assert.deepEqual(f.data(), {});
});

test("extension login creates an HTTP-only website cookie with the server expiry", async () => {
  const f = fixture();
  await f.browser.cookies.remove();
  await f.browser.storage.session.clear();
  await f.handle({
    type: "login",
    email: "shopper@example.test",
    password: "Password1!",
  });
  const cookie = await f.browser.cookies.get();
  assert.equal(cookie.value, token);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.url, "http://localhost:3000/");
  assert.ok(cookie.expirationDate > Date.now() / 1000);
});

test("website logout clears queued work and closes only extension-owned tabs", async () => {
  const f = fixture();
  await f.browser.tabs.create({ url });
  await f.browser.storage.session.set({
    workflow: { status: "Reading", temporaryTabId: 100, sessionToken: token },
  });
  await f.browser.cookies.remove();
  await f.handle.syncSession();
  assert.deepEqual(f.removed, [100]);
  assert.deepEqual(f.data(), {});
  assert.equal((await f.browser.tabs.get(7)).url, url);
});

test("switching website accounts discards a delayed response instead of using its data", async () => {
  const f = fixture();
  let resolveResponse;
  const handle = createWorker(
    f.browser,
    () =>
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
  );
  const pending = handle({ type: "state" });
  while (!resolveResponse)
    await new Promise((resolve) => setTimeout(resolve, 0));
  await f.browser.cookies.set({
    name: "myshoppinglist_session",
    path: "/",
    value: "b".repeat(64),
  });
  await handle.syncSession();
  resolveResponse({
    ok: true,
    status: 200,
    json: async () => ({ account: { id: 1 } }),
  });
  await assert.rejects(pending, /account changed/);
  assert.equal(f.data().token, "b".repeat(64));
  assert.equal(f.data().workflow, undefined);
});

test("default list requests carry the browser timezone", async () => {
  const f = fixture([]);
  await f.handle({ type: "add", url, tabId: 7, quantity: 1 });
  assert.equal(
    f.calls.find((c) => c.url.endsWith("/default")).headers[
      "X-Client-Timezone"
    ],
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
});
