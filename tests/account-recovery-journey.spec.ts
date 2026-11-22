import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { join, resolve } from "node:path";
const frontend = "http://localhost:3001", apiUrl = "http://localhost:5392";
const original = "Original-password9!", replacement = "Replacement-password8!", finalPassword = "Final-password7!";
function sql(input: string) {
  return execFileSync(process.env.PSQL_PATH || "psql", ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }).trim();
}
async function stop(api?: ChildProcess) {
  if (!api || api.exitCode !== null || api.signalCode !== null) return;
  const exited = once(api, "exit"); api.kill();
  await Promise.race([exited, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("Owned API did not stop; fixture schema retained.")), 10000); timer.unref(); })]);
}
async function signIn(page: Page, password: string) {
  await page.goto(frontend); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("recovery-journey@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Sign in to my account" }).click();
}

test("real recovery email, single-use reset and password change preserve lists and revoke sessions", async ({ page, context }, info) => {
  if (!process.env.MYSHOPPINGLIST_TEST_CONNECTION || !process.env.PGPASSWORD || !process.env.PGDATABASE)
    throw new Error("Select the disposable PostgreSQL test connection and matching PG variables.");
  const probe = createServer();
  try { await new Promise<void>((done, reject) => { probe.once("error", reject); probe.listen(5392, done); }); }
  finally { if (probe.listening) await new Promise<void>(done => probe.close(() => done())); }
  const messages: string[] = [], recipients: string[] = [], sockets = new Set<Socket>();
  const smtp = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {}); socket.setTimeout(15000, () => socket.destroy());
    let pending = "", inData = false, data = ""; socket.write("220 loopback-fixture ESMTP\r\n");
    socket.on("data", chunk => {
      pending += chunk.toString();
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, ""); pending = pending.slice(end + 1);
        if (inData) {
          if (line === ".") { messages.push(data); inData = false; data = ""; socket.write("250 accepted locally\r\n"); }
          else data += line.replace(/^\.\./, ".") + "\n";
        } else if (line.startsWith("EHLO ")) socket.write("250-loopback-fixture\r\n250 SIZE 100000\r\n");
        else if (line.startsWith("MAIL FROM:")) socket.write("250 sender accepted\r\n");
        else if (line.startsWith("RCPT TO:")) { recipients.push(line); socket.write("250 recipient accepted\r\n"); }
        else if (line === "DATA") { inData = true; socket.write("354 send data\r\n"); }
        else if (line === "QUIT") socket.end("221 closing\r\n");
        else socket.end("500 unsupported fixture command\r\n");
      }
    });
  });
  await new Promise<void>((done, reject) => { smtp.once("error", reject); smtp.listen(0, "127.0.0.1", done); });
  const smtpPort = (smtp.address() as { port: number }).port;
  const schema = "codex_recovery_" + randomUUID().replaceAll("-", ""), apiRoot = resolve("../myshoppinglist-api");
  let api: ChildProcess | undefined; sql(`CREATE SCHEMA "${schema}";`);
  try {
    const env = { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", DOTNET_ENVIRONMENT: "Development",
      ConnectionStrings__MyShoppingList: `${process.env.MYSHOPPINGLIST_TEST_CONNECTION};Search Path=${schema};Pooling=false`,
      UserExtension__PersonalCapturesEnabled: "true", ProductImport__Enabled: "false", PriceRefresh__Enabled: "false",
      AiIntegration__Enabled: "false", ExtensionBridge__Enabled: "false", Operations__Enabled: "false",
      EmailDelivery__Enabled: "true", EmailDelivery__Host: "127.0.0.1", EmailDelivery__Port: String(smtpPort),
      EmailDelivery__AllowLoopbackWithoutTls: "true", EmailDelivery__FromAddress: "alerts@example.test", EmailDelivery__Username: "", EmailDelivery__Password: "",
      AccountRecovery__Enabled: "true", AccountRecovery__WebsiteOrigin: frontend };
    execFileSync("dotnet", ["ef", "database", "update", "--no-build"], { cwd: apiRoot, env, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    api = spawn("dotnet", [join(apiRoot, "bin/Debug/net10.0/myshoppinglist-api.dll"), "--urls", apiUrl], { cwd: apiRoot, env, windowsHide: true, stdio: "ignore" });
    await expect.poll(async () => {
      if (api?.exitCode !== null) throw new Error("Owned fixture API exited before readiness.");
      try { return (await fetch(apiUrl, { signal: AbortSignal.timeout(1000) })).status; } catch { return 0; }
    }, { timeout: 30000 }).toBe(200);
    await page.goto(frontend); await page.getByRole("button", { name: "Create an account", exact: true }).click();
    await page.getByLabel("Display name", { exact: true }).fill("Recovery shopper"); await page.getByLabel("Email", { exact: true }).fill("recovery-journey@example.test");
    await page.getByLabel("Password", { exact: true }).fill(original); await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("group", { name: "Signed in as Recovery shopper" })).toBeVisible();
    console.log("Recovery journey: registration complete");
    const initialCookie = (await context.cookies()).find(c => c.name === "myshoppinglist_session")!;
    const listsBefore = sql(`SELECT count(*) FROM "${schema}"."ShoppingLists";`);
    // A separate session remains live after this browser signs out; reset must revoke it too.
    expect((await context.request.post(frontend + "/api/auth/login", { headers: { "X-MyShoppingList-Request": "1" }, data: { email: "recovery-journey@example.test", password: original } })).ok()).toBe(true);
    await page.reload(); await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    console.log("Recovery journey: browser signed out");
    expect((await context.request.get(frontend + "/api/auth/me", { headers: { Cookie: `${initialCookie.name}=${initialCookie.value}` } })).status()).toBe(200);
    await signIn(page, "wrong-password"); await page.getByRole("link", { name: "Forgot password?" }).click();
    await page.getByLabel("Account email", { exact: true }).fill("recovery-journey@example.test"); await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an active account uses that email");
    console.log("Recovery journey: request acknowledged");
    await expect.poll(() => messages.find(m => m.includes("Reset your MyShoppingList password")), { timeout: 40000 }).toBeTruthy();
    const mail = messages.find(m => m.includes("Reset your MyShoppingList password"))!.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const link = mail.match(/http:\/\/localhost:3001\/account\/recovery#token=[A-Za-z0-9_-]+/)?.[0]; expect(link).toBeTruthy();
    const token = new URL(link!).hash.slice(7);
    console.log("Recovery journey: local SMTP message received");
    const requests: string[] = []; page.on("request", request => requests.push(request.url()));
    await page.goto(link! + "x"); await page.getByLabel("New password", { exact: true }).fill(replacement); await page.getByLabel("Confirm new password", { exact: true }).fill(replacement);
    await page.getByRole("button", { name: "Reset password", exact: true }).click(); await expect(page.getByRole("main").getByRole("alert")).toContainText("invalid, expired or already used");
    await page.getByRole("button", { name: "Request a new link" }).click(); await expect(page.getByLabel("Account email")).toBeVisible();
    await page.goto(link!); await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
    await page.getByLabel("New password", { exact: true }).fill(replacement); await page.getByLabel("Confirm new password", { exact: true }).fill("mismatch");
    await page.getByRole("button", { name: "Reset password", exact: true }).click(); await expect(page.getByRole("main").getByRole("alert")).toContainText("do not match");
    await page.getByLabel("Confirm new password", { exact: true }).fill(replacement); await page.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Your password was updated"); expect(requests.every(url => !url.includes(token))).toBe(true);
    console.log("Recovery journey: password reset complete");
    expect((await context.request.get(frontend + "/api/auth/me", { headers: { Cookie: `${initialCookie.name}=${initialCookie.value}` } })).status()).toBe(401);
    await signIn(page, original); await expect(page.getByRole("main").getByRole("alert")).toContainText("incorrect");
    await page.getByLabel("Password", { exact: true }).fill(replacement); await page.getByRole("button", { name: "Sign in to my account" }).click();
    await expect(page.getByRole("group", { name: "Signed in as Recovery shopper" })).toBeVisible();
    console.log("Recovery journey: replacement password accepted");
    await page.goto(frontend + "/settings"); await page.getByRole("link", { name: "Account settings", exact: true }).click();
    await page.getByLabel("Current password", { exact: true }).fill(replacement); await page.getByLabel("New password", { exact: true }).fill(finalPassword);
    await page.getByLabel("Confirm new password", { exact: true }).fill(finalPassword); await page.getByRole("button", { name: "Change password and sign out" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your password was changed" })).toBeVisible();
    expect(sql(`SELECT count(*) FROM "${schema}"."ShoppingLists";`)).toBe(listsBefore);
    expect((await context.request.post(frontend + "/api/auth/recovery/complete", { headers: { "X-MyShoppingList-Request": "1" }, data: { token, newPassword: replacement } })).status()).toBe(400);
    expect(recipients.every(r => r.includes("recovery-journey@example.test"))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("password-changed.png"), fullPage: true });
  } finally {
    await stop(api); sql(`DROP SCHEMA "${schema}" CASCADE;`);
    for (const socket of sockets) socket.destroy(); await new Promise<void>(done => smtp.close(() => done()));
  }
});
