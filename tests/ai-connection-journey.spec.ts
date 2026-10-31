import { expect, test } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

const frontend = "http://localhost:3001";
const apiUrl = "http://localhost:5392";
const password = "Disposable-AI-Journey9!";
function sql(input: string) {
  return execFileSync(process.env.PSQL_PATH || "psql", ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }).trim();
}
async function stop(api?: ChildProcess) {
  if (!api || api.exitCode !== null || api.signalCode !== null) return;
  const exited = once(api, "exit"); api.kill();
  await Promise.race([exited, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("Owned API did not stop; test schema retained.")), 10000); timer.unref(); })]);
}

test("real consent, account-switch protection, shared current list and mobile revocation", async ({ page, context }) => {
  if (!process.env.MYSHOPPINGLIST_TEST_CONNECTION || !process.env.PGDATABASE || !process.env.PGPASSWORD)
    throw new Error("Set an explicitly isolated PostgreSQL test connection and matching PG variables.");
  const probe = createServer();
  try { await new Promise<void>((accept, reject) => { probe.once("error", reject); probe.listen(5392, accept); }); }
  finally { if (probe.listening) await new Promise<void>(done => probe.close(() => done())); }
  const schema = "codex_ai_" + randomUUID().replaceAll("-", "");
  const apiRoot = resolve(process.env.MYSHOPPINGLIST_API_PROJECT || "../myshoppinglist-api");
  let api: ChildProcess | undefined;
  sql(`CREATE SCHEMA "${schema}";`);
  try {
    const env = { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", DOTNET_ENVIRONMENT: "Development",
      ConnectionStrings__MyShoppingList: `${process.env.MYSHOPPINGLIST_TEST_CONNECTION};Search Path=${schema};Pooling=false`,
      UserExtension__PersonalCapturesEnabled: "true", ProductImport__Enabled: "false", PriceRefresh__Enabled: "false",
      AiIntegration__Enabled: "true", AiIntegration__Issuer: apiUrl + "/", AiIntegration__Resource: apiUrl + "/mcp",
      AiIntegration__FrontendOrigin: frontend, AiIntegration__DevelopmentEphemeralKeys: "true",
      AiIntegration__AllowedScopes__0: "lists.read", AiIntegration__AllowedScopes__1: "products.read", AiIntegration__AllowedScopes__2: "lists.write",
      AiIntegration__Clients__0__ClientId: "browser-test-ai", AiIntegration__Clients__0__DisplayName: "Journey AI",
      AiIntegration__Clients__0__RedirectUris__0: frontend + "/oauth-test-callback" };
    execFileSync("dotnet", ["ef", "database", "update", "--no-build"], { cwd: apiRoot, env, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    api = spawn("dotnet", [join(apiRoot, "bin/Debug/net10.0/myshoppinglist-api.dll"), "--urls", apiUrl], { cwd: apiRoot, env, windowsHide: true, stdio: "ignore" });
    await expect.poll(async () => {
      if (api?.exitCode !== null) throw new Error("Owned API exited before becoming ready.");
      try { return (await fetch(apiUrl, { signal: AbortSignal.timeout(1000) })).status; } catch { return 0; }
    }, { timeout: 30000 }).toBe(200);
    await page.goto(frontend);
    await page.getByRole("button", { name: "Create an account", exact: true }).click();
    await page.getByLabel("Display name", { exact: true }).fill("AI Shopper A");
    await page.getByLabel("Email", { exact: true }).fill("ai-a@example.test");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("group", { name: "Signed in as AI Shopper A" })).toBeVisible();
    const first = await (await context.request.get(frontend + "/api/auth/me")).json();
    const headers = { "X-MyShoppingList-Request": "1" };
    sql(`UPDATE "${schema}"."UserAccounts" SET "IsPaid"=true WHERE "Id"=${Number(first.account.id)};`);
    const created = await context.request.post(frontend + "/api/shopping-lists", { headers, data: { name: "Shared current list" } });
    expect(created.ok()).toBe(true);
    await page.goto("/ai/connections");
    await expect(page.getByText("No AI apps are connected.", { exact: false })).toBeVisible();
    await page.getByRole("combobox", { name: "Current list", exact: true }).selectOption({ label: "Shared current list" });
    await page.getByRole("button", { name: "Save current list" }).click();
    await expect(page.getByRole("status")).toContainText("Current list saved");
    const selected = await (await context.request.get(frontend + "/api/account/current-list")).json();
    expect(selected.list.name).toBe("Shared current list");
    const currentSession = await (await context.request.get(frontend + "/api/auth/me")).json();
    expect(currentSession.shoppingListId).toBe(selected.list.id);
    expect(currentSession.currentShoppingListId).toBe(selected.list.id);
    await expect(page.getByLabel("Your MCP address", { exact: false })).toHaveValue(apiUrl + "/mcp");

    const verifier = randomBytes(32).toString("base64url");
    const authorization = new URL(apiUrl + "/connect/authorize");
    authorization.search = new URLSearchParams({ client_id: "browser-test-ai", redirect_uri: frontend + "/oauth-test-callback", response_type: "code",
      scope: "lists.read products.read lists.write offline_access", resource: apiUrl + "/mcp", code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), state: "browser-state" }).toString();
    await page.goto(authorization.toString());
    await expect(page.getByRole("heading", { name: "Journey AI wants to connect" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel connection" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("error")).toBe("access_denied");
    await page.goto(authorization.toString());
    await expect(page.getByRole("heading", { name: "Journey AI wants to connect" })).toBeVisible();
    // Change cookies in another tab/request after preview. The old approval must fail closed.
    await context.request.post(frontend + "/api/auth/logout", { headers });
    const second = await context.request.post(frontend + "/api/auth/register", { headers, data: { email: "ai-b@example.test", password, displayName: "AI Shopper B" } });
    expect(second.ok()).toBe(true);
    await page.getByRole("button", { name: "Allow selected permissions" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Your account changed");
    expect(await (await context.request.get(frontend + "/api/ai/connections")).json()).toEqual([]);
    await context.request.post(frontend + "/api/auth/logout", { headers });
    expect((await context.request.post(frontend + "/api/auth/login", { headers, data: { email: "ai-a@example.test", password } })).ok()).toBe(true);
    await page.goto(authorization.toString());
    await expect(page.getByRole("heading", { name: "Journey AI wants to connect" })).toBeVisible();
    await page.getByRole("button", { name: "Allow selected permissions" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has("code")).toBe(true);
    const callback = new URL(page.url());
    expect(callback.searchParams.get("state")).toBe("browser-state");
    const exchanged = await context.request.post(apiUrl + "/connect/token", { form: { grant_type: "authorization_code", client_id: "browser-test-ai",
      redirect_uri: frontend + "/oauth-test-callback", code: callback.searchParams.get("code")!, code_verifier: verifier, resource: apiUrl + "/mcp" } });
    expect(exchanged.ok()).toBe(true);
    const tokens = await exchanged.json();
    const bearer = { Authorization: `Bearer ${tokens.access_token}` };
    const initialized = await context.request.post(apiUrl + "/mcp", { headers: { ...bearer, Accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "browser-test", version: "1.0" } } } });
    expect(initialized.ok()).toBe(true);
    let rpcId = 1;
    async function tool(name: string, args: Record<string, unknown>) {
      const id = ++rpcId;
      const response = await context.request.post(apiUrl + "/mcp", { headers: { ...bearer, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        data: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } } });
      expect(response.ok()).toBe(true);
      const text = await response.text();
      const messages = text.trim().startsWith("{") ? [JSON.parse(text)] : text.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5).trim()));
      const message = messages.find(value => value.id === id);
      expect(message).toBeTruthy(); expect(message.error).toBeUndefined(); expect(message.result.isError).not.toBe(true);
      return message.result.structuredContent;
    }
    const createInput = { requestId: randomUUID(), name: "AI household list" };
    const createdByAi = await tool("create_list", createInput);
    expect((await tool("create_list", createInput)).replayed).toBe(true);
    await tool("set_current_list", { requestId: randomUUID(), listId: createdByAi.listId, expectedSelectionVersion: String(selected.selectionVersion) });
    const addedByAi = await tool("add_product_to_list", { requestId: randomUUID(), listId: createdByAi.listId, genericName: "Unpriced pantry rice", quantity: 2 });
    await page.goto(frontend);
    const aiItem = page.getByRole("region", { name: "Editable shopping list" }).getByRole("article", { name: "Unpriced pantry rice", exact: true });
    await expect(aiItem).toBeVisible(); await expect(aiItem.getByLabel("Item quantity")).toHaveText("2");
    const updatedByAi = await tool("update_list_item", { requestId: randomUUID(), listId: createdByAi.listId, itemId: addedByAi.itemId, expectedUpdatedAt: addedByAi.updatedAt, quantity: 3 });
    await page.reload(); await expect(aiItem.getByLabel("Item quantity")).toHaveText("3");
    await tool("remove_list_item", { requestId: randomUUID(), listId: createdByAi.listId, itemId: addedByAi.itemId, expectedUpdatedAt: updatedByAi.updatedAt, confirm: true });
    await page.reload(); await expect(aiItem).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ai/connections");
    await expect(page.getByRole("heading", { name: "Journey AI", exact: true })).toBeVisible();
    await expect(page.getByText(/Last used/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Revoke access", exact: true }).click();
    await page.getByRole("button", { name: "Revoke access now" }).click();
    await expect(page.getByText("Access revoked", { exact: true })).toBeVisible();
    expect((await context.request.post(apiUrl + "/mcp", { headers: bearer, data: {} })).status()).toBe(401);
  } finally {
    await stop(api);
    sql(`DROP SCHEMA "${schema}" CASCADE;`);
  }
});
