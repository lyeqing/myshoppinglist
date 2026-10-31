import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { writeFile } from "node:fs/promises";
let server: Server;
let events: Record<string, unknown>[] = [];
test.beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = ""; request.on("data", chunk => { raw += chunk; }); request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/analytics/events") { events.push(JSON.parse(raw)); response.statusCode = 204; response.end(); }
      else if (request.url === "/api/analytics/forget") { const { visitorId } = JSON.parse(raw); events = events.filter(e => e.visitorId !== visitorId); response.statusCode = 204; response.end(); }
      else { response.statusCode = 401; response.end(JSON.stringify({ title: "Sign in required." })); }
    });
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(5499, "127.0.0.1", done); });
});
test.afterAll(async () => { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); });
test.beforeEach(() => { events = []; });

test("public content and metadata are present in initial HTML with a public-only sitemap", async ({ request }) => {
  const routes = ["/", "/features", "/how-it-works", "/extension", "/faq", "/pricing", "/support", "/privacy"];
  const titles = new Set<string>();
  for (const route of routes) {
    const response = await request.get(route); expect(response.ok()).toBe(true); const html = await response.text();
    expect(html).toMatch(/<h1[\s>]/); expect(html).toContain('name="description"'); expect(html).toContain('rel="canonical"');
    expect(html).toContain('property="og:title"'); expect(html).toContain('name="twitter:card"');
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1]; expect(title).toBeTruthy(); titles.add(title!);
    expect(html).not.toMatch(/name="robots" content="[^"]*noindex/);
  }
  expect(titles.size).toBe(routes.length);
  const home = await (await request.get("/")).text();
  expect(home).toContain('"@type":"SoftwareApplication"'); expect(home).not.toContain('"aggregateRating"');
  const extension = await (await request.get("/extension")).text(); expect(extension).not.toContain("D:\\pra\\"); expect(extension).not.toContain("Personal capture is being prepared");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect((sitemap.match(/<loc>/g) || []).length).toBe(routes.length); expect(sitemap).not.toContain("/admin"); expect(sitemap).not.toContain("/ai/");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("User-Agent: *"); expect(robots).toContain("Allow: /"); expect(robots).toContain("Disallow: /api"); expect(robots).toContain("Disallow: /superadmin");
  expect(robots).not.toContain("GPTBot"); expect(robots).not.toContain("ClaudeBot");
});

test("public pages fit mobile and private pages remain noindex without private data", async ({ page }) => {
  test.setTimeout(90000); // Fifteen routes include first-time Next development compilation.
  for (const route of ["/features", "/how-it-works", "/extension", "/faq", "/pricing", "/privacy"]) {
    await page.goto(route); await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("navigation", { name: "About MyShoppingList" })).toBeVisible();
  }
  for (const route of ["/settings", "/favorites", "/essentials", "/history", "/products/history", "/in-store", "/ai/connections", "/admin", "/superadmin"]) {
    await page.goto(route); await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
  await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
});

test("campaign tracking requires consent, retains only a source slug and stops on withdrawal", async ({ page }) => {
  await page.goto("/features?utm_source=newsletter&unrelated=private-marker");
  expect(events).toHaveLength(0);
  await page.getByRole("button", { name: "Allow optional analytics" }).click();
  await expect.poll(() => events.filter(e => e.name === "page_view").length).toBe(1);
  await page.goto("/how-it-works");
  await expect.poll(() => events.filter(e => e.name === "page_view").length).toBe(2);
  expect(events.every(e => e.attribution === "newsletter")).toBe(true);
  expect(JSON.stringify(events)).not.toContain("private-marker"); expect(JSON.stringify(events)).not.toContain("https://");
  await page.getByRole("link", { name: "Start a shopping list", exact: true }).click();
  await expect.poll(() => events.some(e => e.name === "cta_click")).toBe(true);
  await page.getByRole("button", { name: "Analytics preferences · allowed" }).click(); await page.getByRole("button", { name: "Decline analytics" }).click();
  await expect.poll(() => events.length).toBe(0);
  await page.goto("/features"); expect(events).toHaveLength(0);
});

test("the share image is a real PNG with no user-specific input", async ({ request }, info) => {
  const response = await request.get("/opengraph-image"); expect(response.ok()).toBe(true); expect(response.headers()["content-type"]).toContain("image/png");
  const png = await response.body(); expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await writeFile(info.outputPath("opengraph.png"), png);
});

test("local production navigation measurements are recorded without a field-performance claim", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("production-"), "Use the production-build config for performance measurements.");
  await page.goto("/features"); await expect(page.getByRole("heading", { name: "Your shopping, kept together" })).toBeVisible();
  const measurement = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return { ttfbMs: Math.round(navigation.responseStart - navigation.requestStart), domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      transferredResourceBytes: resources.reduce((sum, entry) => sum + entry.transferSize, 0), localOnly: true, networkOrCpuThrottled: false, fieldCoreWebVitalsVerified: false };
  });
  expect(Number.isFinite(measurement.ttfbMs)).toBe(true); expect(measurement.domContentLoadedMs).toBeGreaterThan(0);
  await info.attach("local-production-navigation.json", { body: JSON.stringify(measurement), contentType: "application/json" });
  console.info("Public-page local measurement:", JSON.stringify(measurement));
});
