import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
const frontend = "http://localhost:3001", apiUrl = "http://localhost:5392";
function sql(input: string) { return execFileSync(process.env.PSQL_PATH || "psql", ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }).trim(); }
async function register(page: Page, name: string) {
  await page.goto(frontend); await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill(name); await page.getByLabel("Email", { exact: true }).fill(name.toLowerCase() + "@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Operations-journey9!"); await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("group", { name: "Signed in as " + name })).toBeVisible();
}
test("private feedback, consent, protected administration and simulated incident recovery", async ({ page, context, browser }) => {
  if (!process.env.MYSHOPPINGLIST_TEST_CONNECTION || !process.env.PGPASSWORD || !process.env.PGDATABASE) throw new Error("Use an explicitly selected disposable PostgreSQL database.");
  const probe = createServer();
  try { await new Promise<void>((done, reject) => { probe.once("error", reject); probe.listen(5392, done); }); }
  finally { if (probe.listening) await new Promise<void>(done => probe.close(() => done())); }
  const schema = "codex_operations_" + randomUUID().replaceAll("-", ""), apiRoot = resolve("../myshoppinglist-api");
  let api: ChildProcess | undefined; const adminContext = await browser.newContext();
  sql(`CREATE SCHEMA "${schema}";`);
  try {
    const env = { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", DOTNET_ENVIRONMENT: "Development",
      ConnectionStrings__MyShoppingList: `${process.env.MYSHOPPINGLIST_TEST_CONNECTION};Search Path=${schema};Pooling=false`,
      UserExtension__PersonalCapturesEnabled: "true", ProductImport__Enabled: "false", PriceRefresh__Enabled: "false",
      AiIntegration__Enabled: "false", ExtensionBridge__Enabled: "false", Operations__Enabled: "true", Operations__SimulateDelivery: "true",
      Operations__IncidentRecipients__0: "alerts@example.test", Admin__AccountIds__0: "2" };
    execFileSync("dotnet", ["ef", "database", "update", "--no-build"], { cwd: apiRoot, env, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    api = spawn("dotnet", [join(apiRoot, "bin/Debug/net10.0/myshoppinglist-api.dll"), "--urls", apiUrl], { cwd: apiRoot, env, windowsHide: true, stdio: "ignore" });
    await expect.poll(async () => { if (api?.exitCode !== null) throw new Error("Owned API stopped before readiness.");
      try { return (await fetch(apiUrl + "/health/ready", { signal: AbortSignal.timeout(1000) })).status; } catch { return 0; } }, { timeout: 30000 }).toBe(200);
    await page.goto(frontend); await expect(page.getByRole("complementary", { name: "Analytics privacy" })).toHaveCount(0);
    await page.goto(frontend + "/privacy"); await expect(page.getByRole("button", { name: "Allow optional analytics" })).toBeVisible();
    expect(sql(`SELECT count(*) FROM "${schema}"."OperationalEvents" WHERE "VisitorId" IS NOT NULL;`)).toBe("0");
    await page.getByRole("button", { name: "Allow optional analytics" }).click();
    await page.goto(frontend);
    await expect.poll(() => sql(`SELECT count(*) FROM "${schema}"."OperationalEvents" WHERE "VisitorId" IS NOT NULL;`)).toBe("1");
    await register(page, "Customer");
    const customer = await (await context.request.get(frontend + "/api/auth/me")).json(); expect(customer.account.id).toBe(1);
    await page.goto(frontend + "/account/billing?checkout=returned");
    await expect(page.getByText("free · up to 2 active lists")).toBeVisible();
    await expect(page.getByText("Test checkout is not configured.", { exact: false })).toBeVisible();
    expect((await context.request.post(frontend + "/api/billing/checkout", { headers: { "X-MyShoppingList-Request": "1" }, data: { expectedAccountId: 1, requestId: randomUUID(), plan: "monthly" } })).status()).toBe(503);
    expect((await (await context.request.get(frontend + "/api/auth/me")).json()).account.isPaid).toBe(false);
    await page.goto(frontend + "/superadmin"); await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
    expect((await context.request.get(frontend + "/api/admin/operations")).status()).toBe(403);
    await page.goto(frontend + "/support"); await page.getByLabel("Message", { exact: true }).fill("Private fixture feedback for support");
    await page.getByLabel("Screenshot (optional)", { exact: true }).setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64") });
    await page.getByLabel("I reviewed this screenshot and agree to share it privately with support.").check();
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Feedback sent");
    const tickets = await (await context.request.get(frontend + "/api/feedback")).json(); expect(tickets).toHaveLength(1); expect(tickets[0].hasScreenshot).toBe(true);
    const adminPage = await adminContext.newPage(); await register(adminPage, "Administrator");
    const staff = await (await adminContext.request.get(frontend + "/api/auth/me")).json(); expect(staff.account.id).toBe(2);
    await adminPage.goto(frontend + "/superadmin/feedback");
    await expect(adminPage.getByText("Private fixture feedback for support", { exact: true })).toBeVisible();
    await adminPage.getByLabel("Ticket status", { exact: true }).selectOption("planned");
    await adminPage.getByLabel("Response visible to customer", { exact: true }).fill("Thanks. We have planned a fix.");
    await adminPage.getByLabel("Issue reference (internal)", { exact: true }).fill("PRIVATE-INTERNAL-REF");
    await adminPage.getByLabel("Review reason (internal)", { exact: true }).fill("Fixture reviewed");
    await adminPage.getByRole("button", { name: "Save ticket review" }).click(); await expect(adminPage.getByText("No matching feedback tickets.")).toBeVisible();
    await page.getByRole("button", { name: "Refresh tickets" }).click(); await expect(page.getByText("Thanks. We have planned a fix.")).toBeVisible();
    await expect(page.getByText("PRIVATE-INTERNAL-REF")).toHaveCount(0);
    await page.getByText("Account export or deletion", { exact: true }).click();
    await page.getByRole("button", { name: "Prepare a deletion request" }).click();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(/Account deletion request/);
    expect(sql(`SELECT "IsActive" FROM "${schema}"."UserAccounts" WHERE "Id"=1;`)).toBe("t");
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect.poll(() => sql(`SELECT count(*) FROM "${schema}"."FeedbackTickets";`)).toBe("2");
    expect(sql(`SELECT "IsActive" FROM "${schema}"."UserAccounts" WHERE "Id"=1;`)).toBe("t");
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto(frontend + "/privacy");
    await page.getByRole("button", { name: "Analytics preferences · allowed" }).click(); await page.getByRole("button", { name: "Decline analytics" }).click();
    await expect.poll(() => sql(`SELECT count(*) FROM "${schema}"."OperationalEvents" WHERE "VisitorId" IS NOT NULL;`)).toBe("0");
    await adminPage.goto(frontend + "/superadmin"); await expect(adminPage.getByRole("heading", { name: "Operations overview", exact: true })).toBeVisible();
    await expect(adminPage.getByText("Private fixture feedback for support", { exact: true })).toHaveCount(0);
    await adminPage.getByText("Test incident and recovery", { exact: true }).click();
    await adminPage.getByLabel("Simulation reason", { exact: true }).fill("Verify deduplication and recovery");
    await adminPage.getByRole("button", { name: "Simulate P0 failure" }).click(); await expect(adminPage.getByRole("status")).toContainText("No email was sent");
    await adminPage.getByRole("button", { name: "Simulate P0 failure" }).click();
    await expect.poll(() => sql(`SELECT count(*) FROM "${schema}"."AlertDeliveries" WHERE "Kind"='open';`)).toBe("1");
    await adminPage.getByRole("button", { name: "Simulate recovery" }).click();
    await expect.poll(() => sql(`SELECT count(*) FROM "${schema}"."AlertDeliveries" WHERE "Status"='simulated';`)).toBe("2");
    await adminPage.goto(frontend + "/admin"); await adminPage.getByLabel("Search account email").fill("customer@example.test");
    await adminPage.getByRole("button", { name: "Search", exact: true }).click();
    const editor = adminPage.getByRole("article").filter({ has: adminPage.getByRole("heading", { name: "Customer · customer@example.test" }) });
    await editor.getByLabel("Suspend account", { exact: true }).check(); await editor.getByLabel("Review reason", { exact: true }).fill("Fixture suspension");
    await editor.getByRole("button", { name: "Save reviewed decision" }).click();
    expect(sql(`SELECT "IsActive" FROM "${schema}"."UserAccounts" WHERE "Id"=1;`)).toBe("t");
    await editor.getByRole("button", { name: "Confirm reviewed decision" }).click();
    await expect.poll(() => sql(`SELECT "IsActive" FROM "${schema}"."UserAccounts" WHERE "Id"=1;`)).toBe("f");
    expect((await context.request.get(frontend + "/api/feedback")).status()).toBe(401);
    expect(Number(sql(`SELECT count(*) FROM "${schema}"."OperationsAdminAudits";`))).toBeGreaterThan(3);
  } finally {
    await adminContext.close();
    if (api && api.exitCode === null && api.signalCode === null) { const exited = once(api, "exit"); api.kill();
      await Promise.race([exited, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("Owned API did not stop; schema retained.")), 10000); timer.unref(); })]); }
    if (!/^codex_operations_[a-f0-9]{32}$/.test(schema)) throw new Error("Unsafe schema cleanup."); sql(`DROP SCHEMA "${schema}" CASCADE;`);
  }
});
