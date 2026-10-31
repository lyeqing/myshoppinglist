import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
const frontend = "http://localhost:3001", apiUrl = "http://localhost:5392";
const productUrl = "https://www.coles.com.au/product/123456";
function sql(input: string) { return execFileSync(process.env.PSQL_PATH || "psql", ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"],
  { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }).trim(); }
test("installed extension approves MCP captures and bounded searches through real OAuth and API", async ({}, info) => {
  if (!process.env.MYSHOPPINGLIST_TEST_CONNECTION || !process.env.PGPASSWORD || !process.env.PGDATABASE)
    throw new Error("An explicit disposable PostgreSQL connection is required.");
  const probe = createServer();
  try { await new Promise<void>((done, reject) => { probe.once("error", reject); probe.listen(5392, done); }); }
  finally { if (probe.listening) await new Promise<void>(done => probe.close(() => done())); }
  const schema = "codex_bridge_" + randomUUID().replaceAll("-", "");
  const profile = mkdtempSync(join(tmpdir(), "myshoppinglist-bridge-"));
  const apiRoot = resolve("../myshoppinglist-api"), extension = resolve("extensions/shopping-list");
  let context: BrowserContext | undefined, api: ChildProcess | undefined;
  sql(`CREATE SCHEMA "${schema}";`);
  try {
    context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: false,
      viewport: { width: 1200, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        // Fail closed if a new extension-created target navigates before routing attaches.
        "--host-resolver-rules=MAP *.coles.com.au ~NOTFOUND, MAP *.woolworths.com.au ~NOTFOUND, MAP *.aldi.com.au ~NOTFOUND"] });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    // Chromium starts extension-created targets before Playwright can intercept
    // their first navigation. Attach on about:blank, then navigate the same tab.
    // The extension still chooses its validated server URL and all read/save code is real.
    await worker.evaluate(`(() => {
      const original = chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.create = async (options) => {
        const tab = await original({ ...options, url: "about:blank" });
        await new Promise(resolve => setTimeout(resolve, 750));
        await chrome.tabs.update(tab.id, { url: options.url });
        return tab;
      };
    })()`);
    const extensionId = new URL(worker.url()).hostname;
    const env = { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", DOTNET_ENVIRONMENT: "Development",
      ConnectionStrings__MyShoppingList: `${process.env.MYSHOPPINGLIST_TEST_CONNECTION};Search Path=${schema};Pooling=false`,
      UserExtension__PersonalCapturesEnabled: "true", UserExtension__AllowedExtensionIds__0: extensionId,
      ProductImport__Enabled: "false", PriceRefresh__Enabled: "false", ExtensionBridge__Enabled: "true",
      Operations__Enabled: "true", Operations__IncidentRecipients__0: "alerts@example.test",
      AiIntegration__Enabled: "true", AiIntegration__Issuer: apiUrl + "/", AiIntegration__Resource: apiUrl + "/mcp",
      AiIntegration__FrontendOrigin: frontend, AiIntegration__DevelopmentEphemeralKeys: "true",
      AiIntegration__AllowedScopes__0: "lists.read", AiIntegration__AllowedScopes__1: "products.read", AiIntegration__AllowedScopes__2: "extension.capture",
      AiIntegration__Clients__0__ClientId: "extension-journey-ai", AiIntegration__Clients__0__DisplayName: "Extension Journey AI",
      AiIntegration__Clients__0__RedirectUris__0: frontend + "/oauth-test-callback" };
    execFileSync("dotnet", ["ef", "database", "update", "--no-build"], { cwd: apiRoot, env, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    api = spawn("dotnet", [join(apiRoot, "bin/Debug/net10.0/myshoppinglist-api.dll"), "--urls", apiUrl], { cwd: apiRoot, env, windowsHide: true, stdio: "ignore" });
    await expect.poll(async () => {
      if (api?.exitCode !== null) throw new Error("Owned API exited before readiness.");
      try { return (await fetch(apiUrl, { signal: AbortSignal.timeout(1000) })).status; } catch { return 0; }
    }, { timeout: 30000 }).toBe(200);
    const website = context.pages()[0] || await context.newPage();
    await website.goto(frontend);
    await website.getByRole("button", { name: "Create an account", exact: true }).click();
    await website.getByLabel("Display name", { exact: true }).fill("Bridge Shopper");
    await website.getByLabel("Email", { exact: true }).fill("bridge@example.test");
    await website.getByLabel("Password", { exact: true }).fill("Bridge-journey9!");
    await website.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(website.getByRole("group", { name: "Signed in as Bridge Shopper" })).toBeVisible();
    const session = await (await context.request.get(frontend + "/api/auth/me")).json();
    const verifier = randomBytes(32).toString("base64url");
    const authorization = new URL(apiUrl + "/connect/authorize");
    authorization.search = new URLSearchParams({ client_id: "extension-journey-ai", redirect_uri: frontend + "/oauth-test-callback", response_type: "code",
      scope: "lists.read products.read extension.capture", resource: apiUrl + "/mcp", code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), state: "bridge-state" }).toString();
    await website.goto(authorization.toString());
    await website.getByRole("button", { name: "Allow selected permissions" }).click();
    await expect.poll(() => new URL(website.url()).searchParams.has("code")).toBe(true);
    const exchange = await context.request.post(apiUrl + "/connect/token", { form: { grant_type: "authorization_code", client_id: "extension-journey-ai",
      redirect_uri: frontend + "/oauth-test-callback", code: new URL(website.url()).searchParams.get("code")!, code_verifier: verifier, resource: apiUrl + "/mcp" } });
    expect(exchange.ok()).toBe(true); const tokens = await exchange.json(); let rpc = 0;
    async function tool(name: string, args: Record<string, unknown> = {}) {
      const id = ++rpc; const response = await context!.request.post(apiUrl + "/mcp", { headers: { Authorization: "Bearer " + tokens.access_token,
        Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        data: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } } });
      expect(response.ok()).toBe(true); const body = await response.text();
      const messages = body.trim().startsWith("{") ? [JSON.parse(body)] : body.split("\n").filter(l => l.startsWith("data:")).map(l => JSON.parse(l.slice(5).trim()));
      const message = messages.find(m => m.id === id); expect(message.error).toBeUndefined(); expect(message.result.isError).not.toBe(true);
      return message.result.structuredContent;
    }
    expect((await tool("get_extension_status")).status).toBe("not_linked");
    expect(Number(sql(`SELECT count(*) FROM "${schema}"."OperationalEvents" WHERE "Component"='mcp';`))).toBeGreaterThan(0);
    const review = await context.newPage(); await review.goto(`chrome-extension://${extensionId}/ai-requests.html`);
    await expect(review.getByText("Signed in as Bridge Shopper", { exact: true })).toBeVisible();
    await review.getByLabel("Message", { exact: true }).fill("Private installed-extension feedback");
    await review.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect(review.locator("#feedback-status")).toContainText("Feedback sent privately");
    expect(sql(`SELECT count(*) FROM "${schema}"."FeedbackTickets" WHERE "Component"='extension';`)).toBe("1");
    await review.getByRole("button", { name: "Link this extension", exact: true }).click();
    await expect(review.getByRole("button", { name: "Unlink this extension", exact: true })).toBeVisible();
    expect((await tool("get_extension_status")).status).toBe("ready_for_request");
    let retailerVisits = 0;
    const evidence = { "@context": "https://schema.org", "@type": "Product", sku: "123456", url: productUrl, name: "Bridge rice 1kg",
      brand: { name: "Bridge" }, offers: { "@type": "Offer", price: 4, priceCurrency: "AUD", availability: "https://schema.org/InStock" } };
    await context.route(productUrl, route => { retailerVisits++; return route.fulfill({ contentType: "text/html", body:
      `<html><head><link rel="canonical" href="${productUrl}"><script type="application/ld+json">${JSON.stringify(evidence)}</script></head><body><main><h1>Bridge rice 1kg</h1></main></body></html>` }); });
    const task = (await tool("request_extension_capture", { requestId: randomUUID(), url: productUrl, listId: String(session.shoppingListId), quantity: 2 })).task;
    await review.getByRole("button", { name: "Refresh requests" }).click();
    await expect(review.getByRole("button", { name: "Open page and review", exact: true })).toBeVisible();
    expect(retailerVisits).toBe(0);
    await review.getByRole("button", { name: "Open page and review", exact: true }).click();
    await expect(review.locator("#review")).toContainText("Bridge rice 1kg");
    expect(retailerVisits).toBe(1); expect(sql(`SELECT count(*) FROM "${schema}"."Products";`)).toBe("0");
    expect((await tool("get_extension_task_status", { taskId: task.id })).status).toBe("running");
    await review.getByRole("button", { name: "Save to list / Retry save", exact: true }).click();
    await expect(review.locator("#outcome-detail")).toHaveText("Capture: completed.");
    expect((await tool("get_extension_task_status", { taskId: task.id })).status).toBe("completed");
    await website.goto(frontend); await expect(website.getByRole("article", { name: "Bridge rice 1kg", exact: true }).getByLabel("Item quantity")).toHaveText("2");
    await review.bringToFront(); await review.getByRole("button", { name: "Refresh requests" }).click();
    await context.route("https://www.coles.com.au/search/products?q=rice", route => route.fulfill({ contentType: "text/html", body:
      `<html><body><main><h1>rice</h1><div data-testid="search-results"><a href="${productUrl}">Rice</a></div></main></body></html>` }));
    const search = (await tool("request_extension_search", { requestId: randomUUID(), retailer: "coles", query: "rice" })).task;
    await review.getByRole("button", { name: "Refresh requests" }).click();
    await review.getByRole("button", { name: "Open page and review", exact: true }).click();
    await expect(review.locator("#review")).toContainText(productUrl);
    await review.getByRole("button", { name: "Share reviewed links / Retry", exact: true }).click();
    await expect(review.locator("#outcome-detail")).toHaveText("Search: completed.");
    const searched = await tool("get_extension_task_status", { taskId: search.id });
    expect(searched.result.pricesVerified).toBe(false); expect(searched.result.candidates).toHaveLength(1);
    expect(sql(`SELECT count(*) FROM "${schema}"."Products";`)).toBe("1");
    await website.goto(frontend + "/ai/connections"); await website.getByRole("button", { name: "Unlink browser", exact: true }).click();
    await website.getByRole("button", { name: "Unlink browser now" }).click(); await expect(website.getByText("Browser unlinked", { exact: true })).toBeVisible();
    expect((await tool("get_extension_status")).status).toBe("not_linked");
  } finally {
    await context?.tracing.stop({ path: info.outputPath("bridge-trace.zip") }).catch(() => {}); await context?.close();
    if (api && api.exitCode === null && api.signalCode === null) { const exited = once(api, "exit"); api.kill();
      await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Owned API did not stop; schema retained.")), 10000))]); }
    if (!/^codex_bridge_[a-f0-9]{32}$/.test(schema)) throw new Error("Unsafe schema cleanup.");
    sql(`DROP SCHEMA "${schema}" CASCADE;`);
    const absolute = resolve(profile); if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith("myshoppinglist-bridge-")) throw new Error("Unsafe profile cleanup.");
    rmSync(absolute, { recursive: true, force: true });
  }
});
