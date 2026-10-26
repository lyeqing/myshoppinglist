import { chromium, expect, test, type BrowserContext, type Frame, type Page, type Worker } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

const frontend = "http://localhost:3001";
const apiUrl = "http://localhost:5392";
const productName = "Acme Original Coffee 500g";
const coles = "https://www.coles.com.au/product/123456";
const woolworths = "https://www.woolworths.com.au/shop/productdetails/123456";
const password = "Journey-Test9!"; // Disposable accounts in the isolated schema only.

function sql(text: string): string {
  // Connection credentials are supplied only through PG* environment variables.
  return execFileSync(process.env.PSQL_PATH || "psql", ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"],
    { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }).trim();
}

function publicFingerprint(): string {
  return sql(String.raw`
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT format('SELECT json_build_object(''table'',%L,''rows'',count(*),''hash'',md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text) COLLATE "C"),''''))) FROM public.%I t;',tablename,tablename)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE "C"
\gexec
COMMIT;
`);
}

async function requireFreeApiPort() {
  const probe = createServer();
  try {
    await new Promise<void>((accept, reject) => {
      probe.once("error", reject);
      probe.listen(5392, accept);
    });
  } catch {
    throw new Error("Port 5392 is occupied. Stop only an API you own before running this isolated journey; this test never stops another process.");
  } finally {
    if (probe.listening) await new Promise<void>((done) => probe.close(() => done()));
  }
}

async function stopOwnedApi(api: ChildProcess | undefined) {
  if (!api || api.exitCode !== null || api.signalCode !== null) return;
  const stopped = once(api, "exit");
  api.kill();
  await Promise.race([stopped, new Promise<never>((_, reject) => {
    const timeout = setTimeout(() => reject(new Error("Owned test API did not exit; schema cleanup was stopped.")), 10000);
    timeout.unref();
  })]);
}

async function register(page: Page, name: string) {
  await page.goto(frontend);
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(`${name.toLowerCase()}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("group", { name: `Signed in as ${name}`, exact: true })).toBeVisible();
}

async function compactFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => frame.url().includes("/compact.html?ticket="))).toBe(true);
  return page.frames().find((frame) => frame.url().includes("/compact.html?ticket="))!;
}

async function clickToolbar(context: BrowserContext, page: Page, extensionId: string) {
  await page.bringToFront();
  const browser = await context.browser()!.newBrowserCDPSession();
  try {
    // Modern Chromium exposes the outer tab separately from its page target.
    const { targetInfos } = await browser.send("Target.getTargets", { filter: [{ type: "tab" }, { exclude: true }] });
    const tab = targetInfos.find((target) => target.url === page.url());
    if (!tab) throw new Error("The active retailer tab target was not found.");
    await browser.send("Extensions.triggerAction", { id: extensionId, targetId: tab.targetId });
  } finally { await browser.detach(); }
}

async function openCompact(context: BrowserContext, page: Page, worker: Worker, extensionId: string) {
  await clickToolbar(context, page, extensionId);
  await expect.poll(() => worker.evaluate("chrome.storage.session.get('panelUi').then(v => !!v.panelUi?.opened)")).toBe(true);
  // A second toolbar click minimizes through the real extension controller.
  await clickToolbar(context, page, extensionId);
  return compactFrame(page);
}

function retailerHtml(url: string, price: number): string {
  const ld = { "@context": "https://schema.org", "@type": "Product", sku: "123456", url,
    name: productName, gtin: "9300000000002", brand: { name: "Acme" },
    offers: { "@type": "Offer", url, price, priceCurrency: "AUD", availability: "https://schema.org/InStock" } };
  return `<!doctype html><html><head><title>${productName}</title><link rel="canonical" href="${url}">
    <script type="application/ld+json">${JSON.stringify(ld)}</script></head>
    <body><main><h1>${productName}</h1><p>$${price.toFixed(2)}</p></main></body></html>`;
}

test("installed extension saves private observations through the real API and website", async ({}, info) => {
  test.skip(info.project.name !== "personal-chromium", "Use playwright.personal.config.ts; the normal suite has a mock API.");
  const sourceConnection = process.env.MYSHOPPINGLIST_TEST_CONNECTION;
  for (const key of ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"])
    if (!process.env[key]) throw new Error(`Set ${key} for the explicitly selected test database.`);
  if (!sourceConnection) throw new Error("Set MYSHOPPINGLIST_TEST_CONNECTION for the same PostgreSQL database as PGDATABASE.");
  await requireFreeApiPort();
  const apiRoot = resolve(process.env.MYSHOPPINGLIST_API_PROJECT || join(process.cwd(), "../myshoppinglist-api"));
  const extension = resolve("extensions/shopping-list");
  const schema = `codex_activation_${randomUUID().replaceAll("-", "")}`;
  const quoted = `"${schema}"`;
  const profile = mkdtempSync(join(tmpdir(), "myshoppinglist-personal-"));
  const original = publicFingerprint();
  let context: BrowserContext | undefined;
  let api: ChildProcess | undefined;
  let created = false;
  try {
    sql(`CREATE SCHEMA ${quoted};`); created = true;
    context = await chromium.launchPersistentContext(profile, {
      // Native toolbar/side-panel focus requires a regular browser window.
      channel: "chromium", headless: false,
      viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging"],
    });
    context.setDefaultTimeout(20000);
    await context.tracing.start({ screenshots: true, snapshots: true });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).hostname;
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const environment = { ...process.env,
      ConnectionStrings__MyShoppingList: `${sourceConnection};Search Path=${schema};Pooling=false;Application Name=PersonalCaptureJourney`,
      ASPNETCORE_ENVIRONMENT: "Development", DOTNET_ENVIRONMENT: "Development",
      UserExtension__PersonalCapturesEnabled: "true", UserExtension__AllowedExtensionIds__0: extensionId,
      // Intentionally true: personal mode must override these old settings.
      ProductImport__Enabled: "true", PriceRefresh__Enabled: "true",
    };
    execFileSync("dotnet", ["ef", "database", "update", "--no-build", "--project", "myshoppinglist-api.csproj"],
      { cwd: apiRoot, env: environment, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    api = spawn("dotnet", [join(apiRoot, "bin/Debug/net10.0/myshoppinglist-api.dll"), "--urls", apiUrl],
      { cwd: apiRoot, env: environment, windowsHide: true, stdio: "ignore" });
    await expect.poll(async () => {
      if (api!.exitCode !== null) throw new Error("The isolated API exited before becoming ready.");
      try { return (await fetch(apiUrl, { signal: AbortSignal.timeout(1000) })).status; } catch { return 0; }
    }, { timeout: 30000 }).toBe(200);

    const website = context.pages()[0] || await context.newPage();
    await register(website, "JourneyA");
    console.info("[personal journey] First account registered through the website.");
    const sessionA = await (await context.request.get(`${frontend}/api/auth/me`)).json();
    expect(sessionA.shoppingListId).toBeGreaterThan(0);
    let colesPrice = 4;
    await context.route(coles, (route) => route.fulfill({ contentType: "text/html", body: retailerHtml(coles, colesPrice) }));
    await context.route(woolworths, (route) => route.fulfill({ contentType: "text/html", body: retailerHtml(woolworths, 3) }));
    const retailer = await context.newPage();
    await retailer.goto(coles);
    let panel = await openCompact(context, retailer, worker, extensionId);
    // The HTML button exists before the module binds its handlers. Wait for a
    // rendered account, not merely an enabled server-rendered button.
    await expect(panel.locator("#name")).toHaveText("JourneyA");
    await expect(panel.getByRole("button", { name: "Read product", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "Read product", exact: true }).click();
    await expect(panel.locator("#review-name")).toHaveText(productName);
    await expect(panel.locator("#review-price")).toHaveText("$4.00");
    expect(sql(`SELECT count(*) FROM ${quoted}."Products";`)).toBe("0");
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(panel.locator("#review")).toBeHidden();
    expect(sql(`SELECT count(*) FROM ${quoted}."ProductImportJobs";`)).toBe("0");
    await panel.getByRole("button", { name: "Read product", exact: true }).click();
    await expect(panel.locator("#review-name")).toHaveText(productName);
    await panel.getByLabel("Quantity", { exact: true }).fill("2");
    await panel.getByRole("button", { name: "Save to list", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText("Product saved to your list.");
    await retailer.goto(woolworths);
    panel = await compactFrame(retailer);
    await expect(panel.locator("#name")).toHaveText("JourneyA");
    await panel.getByRole("button", { name: "Read product", exact: true }).click();
    await expect(panel.locator("#review-price")).toHaveText("$3.00");
    await panel.getByLabel("Quantity", { exact: true }).fill("2");
    await panel.getByRole("button", { name: "Save to list", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("Product is on your list.");
    console.info("[personal journey] Both retailer observations saved through the installed extension.");

    await website.bringToFront(); await website.reload();
    const card = website.getByRole("region", { name: "Editable shopping list" }).getByRole("article", { name: productName, exact: true });
    await expect(card).toBeVisible(); await expect(card.getByLabel("Item quantity")).toHaveText("2");
    await expect(card).toContainText("Source: Chrome extension");
    await expect(card).not.toContainText("Shared observation");
    const summary = website.getByRole("region", { name: "Shopping cost summary" });
    await expect(summary.getByRole("heading", { name: "Only Coles", exact: true }).locator("..")).toContainText("$8.00");
    await expect(summary.getByRole("heading", { name: "Only Woolworths", exact: true }).locator("..")).toContainText("$6.00");
    await card.getByRole("button", { name: "Add note", exact: true }).click();
    await card.getByLabel("Notes", { exact: true }).fill("Keep this private pantry note");
    await card.getByRole("button", { name: "Save note", exact: true }).click();
    await card.getByRole("button", { name: `Add ${productName} to Favorites`, exact: true }).click();
    await expect(card.getByRole("button", { name: `Remove ${productName} from Favorites`, exact: true })).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: `Add ${productName} to Essentials`, exact: true }).click();
    await expect(card.getByRole("button", { name: `Remove ${productName} from Essentials`, exact: true })).toHaveAttribute("aria-pressed", "true");
    await website.screenshot({ path: info.outputPath("desktop-private-comparison.png"), fullPage: true });
    for (const [path, title] of [["/favorites", "Favorites"], ["/essentials", "Essentials"], ["/products/history", "Product history"]]) {
      await website.goto(frontend + path);
      await expect(website.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(website.getByRole("heading", { name: productName, exact: true })).toBeVisible();
      await expect(website.getByRole("navigation", { name: "Product pages" }).getByRole("link", { name: title, exact: true })).toHaveAttribute("aria-current", "page");
    }
    await website.setViewportSize({ width: 390, height: 844 });
    await website.goto(frontend);
    await expect(card.getByLabel("Item quantity")).toHaveText("2");
    await card.getByRole("button", { name: "Increase quantity", exact: true }).click();
    await expect(card.getByLabel("Item quantity")).toHaveText("3");
    await expect(card).toContainText("Keep this private pantry note");
    expect(await website.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await website.screenshot({ path: info.outputPath("mobile-private-list.png"), fullPage: true });
    console.info("[personal journey] Desktop comparisons, saved-product pages and mobile editing verified.");

    // Switch accounts through the real website, with the same installed worker.
    // Its cookie observer must discard the first account's review and selection.
    await website.bringToFront();
    await website.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(website.getByRole("button", { name: "Create an account", exact: true })).toBeVisible();
    console.info("[personal journey] First account signed out.");
    await register(website, "JourneyB");
    console.info("[personal journey] Second account registered through the website.");
    const sessionB = await (await context.request.get(`${frontend}/api/auth/me`)).json();
    expect(sessionB.account.id).not.toBe(sessionA.account.id);
    const inaccessible = await context.request.get(`${frontend}/api/shopping-lists/${sessionA.shoppingListId}/items`);
    expect(inaccessible.status()).toBe(404);
    await website.goto(`${frontend}/favorites`);
    await expect(website.getByText(/No Favorites yet/)).toBeVisible();
    colesPrice = 9;
    await retailer.bringToFront(); await retailer.goto(coles);
    panel = await compactFrame(retailer);
    await expect(panel.locator("#name")).toHaveText("JourneyB");
    await expect(panel.locator("#review")).toBeHidden();
    await panel.getByRole("button", { name: "Read product", exact: true }).click();
    await expect(panel.locator("#review-price")).toHaveText("$9.00");
    await panel.getByRole("button", { name: "Save to list", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText("Product saved to your list.");
    const stored = JSON.parse(sql(`SELECT json_build_object(
      'products',(SELECT count(*) FROM ${quoted}."Products"),
      'aPrice',(SELECT "Price" FROM ${quoted}."ShopProductPrices" WHERE "UserAccountId"=${sessionA.account.id} AND "ShopProductId" IN (SELECT "Id" FROM ${quoted}."ShopProducts" WHERE "ShopId"=1)),
      'bPrice',(SELECT "Price" FROM ${quoted}."ShopProductPrices" WHERE "UserAccountId"=${sessionB.account.id}),
      'aQuantity',(SELECT "Quantity" FROM ${quoted}."ShoppingListProducts" WHERE "ShoppingListId"=${sessionA.shoppingListId}),
      'tasks',(SELECT count(*) FROM ${quoted}."ColesExtensionTasks")+(SELECT count(*) FROM ${quoted}."UserExtensionImportTasks")+(SELECT count(*) FROM ${quoted}."PackDiscoveryJobs")+(SELECT count(*) FROM ${quoted}."BrandDiscoveryJobs"));`));
    expect(stored).toEqual({ products: 2, aPrice: 4, bPrice: 9, aQuantity: 3, tasks: 0 });
    await website.goto(frontend);
    await expect(card.getByLabel("Item quantity")).toHaveText("1");
    await expect(card).not.toContainText("Keep this private pantry note");
    await expect(card.getByRole("button", { name: `Add ${productName} to Favorites`, exact: true })).toHaveAttribute("aria-pressed", "false");
  } finally {
    try {
      await context?.tracing.stop({ path: info.outputPath("journey-trace.zip") }).catch(() => {
        // Optional diagnostics must not hide the actual workflow failure if
        // Chromium exits before teardown can save its trace.
        console.warn("[personal journey] Browser trace could not be saved.");
      });
      await context?.close();
    } finally {
      await stopOwnedApi(api);
      if (created) {
        if (!/^codex_activation_[a-f0-9]{32}$/.test(schema)) throw new Error("Refusing unsafe schema cleanup.");
        sql(`DROP SCHEMA ${quoted} CASCADE;`);
      }
      // Verify the resolved absolute path belongs to this freshly created temp
      // profile before recursive removal; never touch a user's Chrome profile.
      const absolute = resolve(profile);
      if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith("myshoppinglist-personal-")
          || !absolute.startsWith(resolve(tmpdir()) + sep)) throw new Error("Refusing unsafe profile cleanup.");
      rmSync(absolute, { recursive: true, force: true });
      expect(publicFingerprint()).toBe(original);
    }
  }
});
