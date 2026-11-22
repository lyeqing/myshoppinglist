import { expect, test } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { resolve } from "node:path";

const frontend = "http://127.0.0.1:3001", apiUrl = "http://127.0.0.1:5393";
const password = "Original-password9!", replacement = "Replacement-password8!";
function sql(input: string) {
  return execFileSync(process.env.PSQL_PATH || "D:/PostgreSQL/bin/psql.exe", ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000 }).trim();
}
async function stop(api?: ChildProcess) {
  if (!api || api.exitCode !== null || api.signalCode !== null) return;
  const exited = once(api, "exit"); api.kill();
  await Promise.race([exited, new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Owned fixture API did not stop; test schema retained.")), 10000); timer.unref();
  })]);
}

test("real account profile, email verification and password changes preserve shopping data", async ({ page }, info) => {
  if (!process.env.MYSHOPPINGLIST_TEST_CONNECTION?.includes("Host=127.0.0.1;Port=55432;") || process.env.PGPORT !== "55432" || process.env.PGHOST !== "127.0.0.1"
    || !process.env.PGPASSWORD || process.env.PGDATABASE !== "account_only_tests")
    throw new Error("Select the disposable loopback PostgreSQL cluster on 55432 and its matching PG credentials.");
  const apiRoot = resolve("../myshoppinglist-api"), root = resolve(apiRoot, ".local-dotnet/account-settings-tests");
  const messages: string[] = [], sockets = new Set<Socket>();
  const smtp = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    socket.write("220 loopback account-settings fixture\r\n");
    let pending = "", data = "", inData = false;
    socket.on("data", chunk => {
      pending += chunk.toString(); let split;
      while ((split = pending.indexOf("\r\n")) >= 0) {
        const line = pending.slice(0, split); pending = pending.slice(split + 2);
        if (inData) {
          if (line === ".") { messages.push(data); data = ""; inData = false; socket.write("250 accepted locally\r\n"); }
          else data += line.replace(/^\.\./, ".") + "\n";
        } else if (line.startsWith("EHLO ")) socket.write("250-loopback-fixture\r\n250 SIZE 100000\r\n");
        else if (line.startsWith("MAIL FROM:") || line.startsWith("RCPT TO:")) socket.write("250 accepted\r\n");
        else if (line === "DATA") { inData = true; socket.write("354 send data\r\n"); }
        else if (line === "QUIT") socket.end("221 closing\r\n");
        else socket.end("500 unsupported fixture command\r\n");
      }
    });
  });
  await new Promise<void>((done, reject) => { smtp.once("error", reject); smtp.listen(0, "127.0.0.1", done); });
  const schema = "codex_settings_" + randomUUID().replaceAll("-", ""); let api: ChildProcess | undefined;
  sql(`CREATE SCHEMA "${schema}";`);
  try {
    // Use psql's file input rather than a large synchronous stdin pipe on Windows.
    execFileSync(process.env.PSQL_PATH || "D:/PostgreSQL/bin/psql.exe", ["-X", "-w", "-q", "-v", "ON_ERROR_STOP=1",
      "-c", `SET search_path TO "${schema}";`, "-f", resolve(root, "schema.sql")], { stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    const env = { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", DOTNET_ENVIRONMENT: "Development",
      ConnectionStrings__MyShoppingList: `${process.env.MYSHOPPINGLIST_TEST_CONNECTION};Search Path=${schema};Pooling=false`,
      AiIntegration__Enabled: "false", Operations__Enabled: "false", ExtensionBridge__Enabled: "false",
      ProductImport__Enabled: "false", PriceRefresh__Enabled: "false", UserExtension__PersonalCapturesEnabled: "true",
      EmailDelivery__Enabled: "true", EmailDelivery__Host: "127.0.0.1", EmailDelivery__Port: String((smtp.address() as { port: number }).port),
      EmailDelivery__AllowLoopbackWithoutTls: "true", EmailDelivery__FromAddress: "alerts@example.test", EmailDelivery__Username: "", EmailDelivery__Password: "",
      AccountRecovery__Enabled: "true", AccountRecovery__WebsiteOrigin: frontend,
      AccountSecurity__KeyDirectory: resolve(root, "journey-keys"), AccountSecurity__KeyCertificatePath: "" };
    api = spawn("dotnet", [resolve(root, "myshoppinglist-api.dll"), "--urls", apiUrl], { cwd: apiRoot, env, windowsHide: true, stdio: "ignore" });
    await expect.poll(async () => {
      if (api?.exitCode !== null) throw new Error("Owned fixture API exited before readiness.");
      try { return (await fetch(apiUrl + "/api/auth/recovery", { signal: AbortSignal.timeout(1000) })).status; } catch { return 0; }
    }, { timeout: 30000 }).toBe(200);
    await page.goto(frontend);
    await page.locator("header").getByRole("button", { name: "Create an account", exact: true }).click();
    await page.getByLabel("Display name", { exact: true }).fill("Journey shopper");
    await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("group", { name: "Signed in as Journey shopper", exact: true })).toBeVisible();
    const before = sql(`SELECT "Id"::text || ':' || "UserAccountId"::text || ':' || "Name" FROM "${schema}"."ShoppingLists" ORDER BY "Id";`);
    await page.getByRole("link", { name: "Account settings for Journey shopper", exact: true }).click();
    await page.getByLabel("Display name", { exact: false }).fill("Morgan");
    await page.getByRole("button", { name: "Save display name", exact: true }).click();
    await expect(page.getByRole("group", { name: "Signed in as Morgan", exact: true })).toBeVisible();
    await page.getByLabel("New email address", { exact: true }).fill("new@example.test");
    await page.getByLabel("Current password for email change", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Send verification link", exact: true }).click();
    await expect(page.getByText("Pending verification:", { exact: false })).toContainText("new@example.test");
    expect(sql(`SELECT "Email" FROM "${schema}"."UserAccounts";`)).toBe("owner@example.test");
    await expect.poll(() => messages.some(mail => mail.includes("Verify your new MyShoppingList email address")), { timeout: 30000 }).toBe(true);
    const rawMail = messages.find(value => value.includes("Verify your new MyShoppingList email address"))!;
    await info.attach("local-verification-email", { body: rawMail, contentType: "text/plain" });
    const separator = rawMail.indexOf("\n\n");
    const headers = rawMail.slice(0, separator), body = rawMail.slice(separator + 2);
    const mail = /Content-Transfer-Encoding:\s*base64/i.test(headers) ? Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8")
      : /Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)
        ? body.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))) : body;
    const link = mail.match(/http:\/\/127\.0\.0\.1:3001\/account\/security#email=[A-Za-z0-9_.-]+/)?.[0]; expect(link).toBeTruthy();
    await page.goto(link!);
    await expect(page.getByRole("button", { name: "Confirm new email and sign out" })).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
    expect(sql(`SELECT "Email" FROM "${schema}"."UserAccounts";`)).toBe("owner@example.test");
    await page.getByRole("button", { name: "Confirm new email and sign out" }).click();
    await expect(page.getByText("Your email address was changed and verified.", { exact: false })).toBeVisible();
    expect(sql(`SELECT "Email" FROM "${schema}"."UserAccounts";`)).toBe("new@example.test");
    await page.goto(frontend); await page.locator("header").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("new@example.test"); await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in to my account" }).click();
    await expect(page.getByRole("group", { name: "Signed in as Morgan", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Account settings for Morgan", exact: true }).click();
    await page.getByLabel("Current password", { exact: true }).fill(password);
    await page.getByLabel("New password", { exact: true }).fill(replacement); await page.getByLabel("Confirm new password", { exact: true }).fill(replacement);
    await page.getByRole("button", { name: "Change password and sign out" }).click();
    await expect(page.getByText("Your password was changed.", { exact: false })).toBeVisible();
    expect(sql(`SELECT "Id"::text || ':' || "UserAccountId"::text || ':' || "Name" FROM "${schema}"."ShoppingLists" ORDER BY "Id";`)).toBe(before);
    expect(sql(`SELECT "DisplayName" FROM "${schema}"."UserAccounts";`)).toBe("Morgan");
    await page.screenshot({ path: info.outputPath("verified-account-settings.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await stop(api); sql(`DROP SCHEMA "${schema}" CASCADE;`);
    for (const socket of sockets) socket.destroy(); await new Promise<void>(done => smtp.close(() => done()));
  }
});
