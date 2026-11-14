import { chromium, expect, test, type BrowserContext, type Frame, type Page, type Worker } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

const frontend = "http://localhost:3001";
const apiUrl = process.env.MYSHOPPINGLIST_TEST_API_URL || "http://localhost:5392";
const apiPort = Number(new URL(apiUrl).port);
if (new URL(apiUrl).origin !== `http://localhost:${apiPort}` || !Number.isInteger(apiPort) || apiPort < 1024 || [3000, 3001].includes(apiPort))
  throw new Error("Select a dedicated localhost API test port.");
const productName = "Acme Original Coffee 500g";
const coles = "https://www.coles.com.au/product/123456";
const woolworths = "https://www.woolworths.com.au/shop/productdetails/123456";
const aldi = "https://www.aldi.com.au/product/budget-original-coffee-500g-000000000123456";
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
  for (const host of ["127.0.0.1", "::1"]) {
    const occupied = await new Promise<boolean>((accept, reject) => {
      const socket = createConnection({ host, port: apiPort });
      socket.setTimeout(2000);
      socket.once("connect", () => { socket.destroy(); accept(true); });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        socket.destroy();
        if (["ECONNREFUSED", "EAFNOSUPPORT", "ENETUNREACH"].includes(error.code || "")) accept(false); else reject(error);
      });
      socket.once("timeout", () => { socket.destroy(); reject(new Error("The test port could not be verified as free.")); });
    });
    if (occupied) throw new Error(`Port ${apiPort} is occupied. The isolated journey will not use or stop another API.`);
  }
  const probe = createServer();
  try {
    await new Promise<void>((accept, reject) => { probe.once("error", reject); probe.listen(apiPort, accept); });
  } finally {
    if (probe.listening) await new Promise<void>(done => probe.close(() => done()));
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
  const apiConfiguration = process.env.MYSHOPPINGLIST_API_CONFIGURATION || "Debug";
  const extensionSource = resolve("extensions/shopping-list");
  const schema = `codex_activation_${randomUUID().replaceAll("-", "")}`;
  const quoted = `"${schema}"`;
  const profile = mkdtempSync(join(tmpdir(), "myshoppinglist-personal-"));
  const extension = join(profile, "test-extension");
  const original = publicFingerprint();
  let context: BrowserContext | undefined;
  let api: ChildProcess | undefined;
  let created = false;
  try {
    sql(`CREATE SCHEMA ${quoted};`); created = true;
    cpSync(extensionSource, extension, { recursive: true });
    const backgroundPath = join(extension, "background.js");
    const backgroundSource = readFileSync(backgroundPath, "utf8");
    if (!backgroundSource.includes('export const API_URL = "http://localhost:5392";')) throw new Error("The extension API setting could not be isolated.");
    writeFileSync(backgroundPath, backgroundSource.replace('export const API_URL = "http://localhost:5392";', `export const API_URL = ${JSON.stringify(apiUrl)};`));
    context = await chromium.launchPersistentContext(profile, {
      // Native toolbar/side-panel focus requires a regular browser window.
      channel: "chromium", headless: false,
      viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging",
        "--host-resolver-rules=MAP *.coles.com.au ~NOTFOUND, MAP *.woolworths.com.au ~NOTFOUND, MAP *.aldi.com.au ~NOTFOUND"],
    });
    context.setDefaultTimeout(20000);
    await context.tracing.start({ screenshots: true, snapshots: true });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    // Extension-created targets can navigate before Playwright attaches routing.
    // Start on about:blank, attach, then navigate the same owned tab to the real
    // server-selected URL. All extraction, validation and persistence stays real.
    await worker.evaluate(`(() => {
      const create = chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.create = async options => {
        const tab = await create({ ...options, url: "about:blank" });
        await new Promise(resolve => setTimeout(resolve, 750));
        await chrome.tabs.update(tab.id, { url: options.url });
        return tab;
      };
    })()`);
    const extensionId = new URL(worker.url()).hostname;
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const environment = { ...process.env,
      ConnectionStrings__MyShoppingList: `${sourceConnection};Search Path=${schema};Pooling=false;Application Name=PersonalCaptureJourney`,
      ASPNETCORE_ENVIRONMENT: "Development", DOTNET_ENVIRONMENT: "Development", ASPNETCORE_URLS: apiUrl, URLS: apiUrl,
      UserExtension__PersonalCapturesEnabled: "true", UserExtension__AllowedExtensionIds__0: extensionId,
      // Intentionally true: personal mode must override these old settings.
      ProductImport__Enabled: "true", PriceRefresh__Enabled: "true",
    };
    execFileSync("dotnet", ["ef", "database", "update", "--no-build", "--configuration", apiConfiguration, "--project", "myshoppinglist-api.csproj"],
      { cwd: apiRoot, env: environment, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    api = spawn("dotnet", [join(apiRoot, "bin", apiConfiguration, "net10.0/myshoppinglist-api.dll"), "--urls", apiUrl],
      { cwd: apiRoot, env: environment, windowsHide: true, stdio: "ignore" });
    await expect.poll(async () => {
      if (api!.exitCode !== null) throw new Error("The isolated API exited before becoming ready.");
      try { return (await fetch(apiUrl, { signal: AbortSignal.timeout(1000) })).status; } catch { return 0; }
    }, { timeout: 30000 }).toBe(200);

    // Before any browser-driven mutation, prove that both HTTP routes reach
    // this run's isolated schema and that the new comparison API is loaded.
    const probeName = `Isolation probe ${schema}`;
    const probeToken = randomBytes(32).toString("hex");
    const probeHash = createHash("sha256").update(probeToken, "ascii").digest("hex");
    sql(`WITH account AS (
      INSERT INTO ${quoted}."UserAccounts" ("DisplayName","IsTrial","ExpiresDate","IsActive","IsPaid","ContributionBlocked","CreatedDate","UpdatedDate")
      VALUES ('${probeName}',true,now()+interval '1 hour',true,false,false,now(),now()) RETURNING "Id"
    ) INSERT INTO ${quoted}."UserSessions" ("UserAccountId","TokenHash","CreatedDate","ExpiresDate")
      SELECT "Id",'${probeHash}',now(),now()+interval '1 hour' FROM account;`);
    const directProbe = await context.request.get(`${apiUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${probeToken}` } });
    expect(directProbe.status(), "The test API must read the isolated probe account before any writes.").toBe(200);
    expect((await directProbe.json()).account.displayName).toBe(probeName);
    const featureProbe = await context.request.get(`${apiUrl}/api/user-extension/comparisons/pending`, {
      headers: { Authorization: `Bearer ${probeToken}`, "X-MyShoppingList-Extension": extensionId } });
    expect(featureProbe.status(), "The test API must include private retailer comparisons.").toBe(200);
    const websiteProbe = await context.request.get(`${frontend}/api/auth/me`, { headers: { Cookie: `myshoppinglist_session=${probeToken}` } });
    expect(websiteProbe.status(), "The website proxy must read the isolated probe account before any writes.").toBe(200);
    expect((await websiteProbe.json()).account.displayName).toBe(probeName);
    console.info("[personal journey] Private API schema, comparison API and website proxy preflights passed.");

    const website = context.pages()[0] || await context.newPage();
    await register(website, "JourneyA");
    console.info("[personal journey] First account registered through the website.");
    const sessionA = await (await context.request.get(`${frontend}/api/auth/me`)).json();
    expect(sessionA.shoppingListId).toBeGreaterThan(0);
    let colesPrice = 4;
    await context.route(coles, (route) => route.fulfill({ contentType: "text/html", body: retailerHtml(coles, colesPrice) }));
    await context.route(woolworths, (route) => route.fulfill({ contentType: "text/html", body: retailerHtml(woolworths, 3) }));
    await context.route("https://www.woolworths.com.au/shop/search/products?**", route => {
      const query = new URL(route.request().url()).searchParams.get("searchTerm");
      return route.fulfill({ contentType: "text/html", body: `<main><h1>Showing results for ${query}</h1><div data-testid="search-results-product-scrollable-content"><a href="${woolworths}">${productName}</a></div></main>` });
    });
    await context.route("https://www.aldi.com.au/results?**", route => {
      const query = new URL(route.request().url()).searchParams.get("q");
      return route.fulfill({ contentType: "text/html", body: `<main class="product-listing-page"><h1>Search: ${query}</h1><div class="product-listing-viewer"><span data-mn="product-search-count">(1)</span><div data-test="product-tile"><a href="${aldi}">Budget Original Coffee 500g</a></div></div></main>` });
    });
    await context.route(aldi, route => {
      const name = "Budget Original Coffee 500g";
      const ld = { "@type": "Product", name, brand: { name: "Budget" }, gtin: "9300000000019",
        offers: { "@type": "Offer", price: 2.5, priceCurrency: "AUD", url: aldi } };
      return route.fulfill({ contentType: "text/html", body: `<html><head><link rel="canonical" href="${aldi}"><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><main><h1>${name}</h1></main></body></html>` });
    });
    const retailer = await context.newPage();
    await retailer.goto(coles);
    let panel = await openCompact(context, retailer, worker, extensionId);
    // The HTML button exists before the module binds its handlers. Wait for a
    // rendered account, not merely an enabled server-rendered button.
    await expect(panel.locator("#name")).toHaveText("JourneyA");
    await expect(panel.getByRole("button", { name: "Read product", exact: true })).toBeEnabled();
    const requestHeaders = { "X-MyShoppingList-Request": "1" };
    expect((await context.request.post(`${frontend}/api/shopping-lists`, { headers: requestHeaders, data: { name: "Shared extension current list" } })).ok()).toBe(true);
    const management = await (await context.request.get(`${frontend}/api/shopping-lists/manage`)).json();
    const sharedList = management.lists.find((list: { name: string }) => list.name === "Shared extension current list");
    expect(sharedList).toBeTruthy();
    expect((await context.request.put(`${frontend}/api/account/current-list`, { headers: requestHeaders,
      data: { expectedAccountId: sessionA.account.id, shoppingListId: sharedList.id, expectedSelectionVersion: 0 } })).ok()).toBe(true);
    await retailer.reload(); panel = await compactFrame(retailer);
    await expect(panel.locator("#list")).toHaveValue(String(sharedList.id));
    expect((await context.request.put(`${frontend}/api/account/current-list`, { headers: requestHeaders,
      data: { expectedAccountId: sessionA.account.id, shoppingListId: sessionA.shoppingListId, expectedSelectionVersion: 1 } })).ok()).toBe(true);
    await retailer.reload(); panel = await compactFrame(retailer);
    await expect(panel.locator("#list")).toHaveValue(String(sessionA.shoppingListId));
    expect(await panel.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await panel.getByLabel("Quantity", { exact: true }).fill("2");
    await panel.getByRole("button", { name: "Add to list", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("Product saved");
    await expect.poll(() => worker.evaluate("chrome.storage.session.get('personalComparisons').then(v => v.personalComparisons?.jobs.at(-1)?.response?.status)")).toBe("Completed");
    await retailer.goto(woolworths);
    panel = await compactFrame(retailer);
    await expect(panel.locator("#name")).toHaveText("JourneyA");
    await panel.getByLabel("Quantity", { exact: true }).fill("2");
    await panel.getByRole("button", { name: "Add to list", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("Product is on your list.");
    console.info("[personal journey] Both retailer observations saved through the installed extension.");

    await website.bringToFront(); await website.reload();
    const card = website.getByRole("region", { name: "Editable shopping list" }).getByRole("article", { name: productName, exact: true });
    await expect(card).toBeVisible(); await expect(card.getByLabel("Item quantity")).toHaveText("2");
    await expect(card).toContainText("Source: Chrome extension");
    await expect(card).not.toContainText("Shared observation");
    await expect(card.getByRole("region", { name: "Automatic retailer checks" })).toContainText("Alternatives · excluded from exact totals");
    await expect(card).toContainText("Budget Original Coffee 500g");
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
    await panel.getByRole("button", { name: "Add to list", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("Product saved");
    await expect.poll(() => worker.evaluate("chrome.storage.session.get('personalComparisons').then(v => v.personalComparisons?.jobs.at(-1)?.response?.status)")).toBe("Completed");
    const stored = JSON.parse(sql(`SELECT json_build_object(
      'products',(SELECT count(*) FROM ${quoted}."Products"),
      'aPrice',(SELECT "Price" FROM ${quoted}."ShopProductPrices" WHERE "UserAccountId"=${sessionA.account.id} AND "ShopProductId" IN (SELECT "Id" FROM ${quoted}."ShopProducts" WHERE "ShopId"=1)),
      'bPrice',(SELECT "Price" FROM ${quoted}."ShopProductPrices" WHERE "UserAccountId"=${sessionB.account.id} AND "ShopProductId" IN (SELECT "Id" FROM ${quoted}."ShopProducts" WHERE "ShopId"=1)),
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
