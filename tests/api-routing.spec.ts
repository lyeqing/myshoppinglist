import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";

const token = "a".repeat(64);
const session = { account: { id: 7, displayName: "Alex Shopper", email: "alex@example.test", isTrial: false, isPaid: false, expiresDate: null },
  shoppingListId: 1, sessionExpiresDate: "2099-01-01T00:00:00Z" };
const screenshot = Buffer.from("fixture-image");

test("server transport uses internal API for browser sessions, SSR and downloads without public calls", async ({ page, request }) => {
  test.setTimeout(90000);
  const internalCalls: { path: string; cookie: string }[] = [];
  let publicCalls = 0;
  const internal = createServer(async (incoming, outgoing) => {
    const path = incoming.url ?? "";
    const cookie = incoming.headers.cookie ?? "";
    internalCalls.push({ path, cookie });
    outgoing.setHeader("Content-Type", "application/json");
    if (path === "/api/auth/social/providers") return outgoing.end("[]");
    if (path === "/api/auth/login") {
      let body = "";
      for await (const part of incoming) body += part.toString();
      if (JSON.parse(body).email === "limited@example.test") {
        outgoing.writeHead(429, { "Retry-After": "12" });
        return outgoing.end(JSON.stringify({ title: "Too many requests" }));
      }
      outgoing.setHeader("Set-Cookie", `myshoppinglist_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
      return outgoing.end(JSON.stringify(session));
    }
    if (path === "/api/auth/logout") {
      outgoing.writeHead(204, { "Set-Cookie": "myshoppinglist_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/" });
      return outgoing.end();
    }
    if (path === "/api/admin/session" || path === "/api/auth/me" && !cookie.includes(token)) {
      outgoing.writeHead(401); return outgoing.end("{}");
    }
    if (path === "/api/auth/me") return outgoing.end(JSON.stringify(session));
    if (path === "/api/shopping-lists/manage") return outgoing.end(JSON.stringify({ isPaid: false, limit: 2, lists: [{ id: 1, name: "Weekly" }] }));
    if (path.endsWith("/plan")) return outgoing.end(JSON.stringify({ id: 1, name: "Weekly", items: [], retailers: [], lowest: { subtotal: 0, pricedCount: 0, missingItems: [] } }));
    if (path.endsWith("/screenshot")) {
      outgoing.writeHead(200, { "Content-Type": "image/png" }); return outgoing.end(screenshot);
    }
    return outgoing.end(JSON.stringify({ items: [], nextBeforeId: null }));
  });
  const publicApi = createServer((incoming, outgoing) => {
    publicCalls++; outgoing.writeHead(503); outgoing.end("Public endpoint must not be used by Next.js");
  });
  const listen = (server: Server, port: number) => new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(port, "127.0.0.1", resolve);
  });
  const close = (server: Server) => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  try {
    await listen(internal, 5499); await listen(publicApi, 5500);
    const browserApiRequests: string[] = [];
    page.on("request", incoming => { if (incoming.url().includes("/api/")) browserApiRequests.push(incoming.url()); });
    await page.goto("/");
    await page.locator("header").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(session.account.email);
    await page.getByLabel("Password", { exact: true }).fill("ValidPassword1!");
    await page.getByRole("button", { name: "Sign in to my account", exact: true }).click();
    await expect(page.getByRole("group", { name: "Signed in as Alex Shopper", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("group", { name: "Signed in as Alex Shopper", exact: true })).toBeVisible();
    const cookie = (await page.context().cookies()).find(value => value.name === "myshoppinglist_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain(token);

    const admin = await request.get("/admin", { headers: { Cookie: `myshoppinglist_session=${token}; unrelated=never-forward` } });
    expect(await admin.text()).toContain("Administrator access required");
    expect(internalCalls).toContainEqual({ path: "/api/admin/session", cookie: `myshoppinglist_session=${token}` });
    const image = await request.get("/api/feedback/00000000-0000-0000-0000-000000000001/screenshot", { headers: { Cookie: `myshoppinglist_session=${token}; unrelated=never-forward` } });
    expect(image.status()).toBe(200); expect(await image.body()).toEqual(screenshot);
    expect(image.headers()["content-disposition"]).toContain("attachment");
    const limited = await request.post("/api/auth/login", { headers: { "X-MyShoppingList-Request": "1" }, data: { email: "limited@example.test", password: "fixture" } });
    expect(limited.status()).toBe(429); expect(limited.headers()["retry-after"]).toBe("12");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.locator("header").getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    expect(internalCalls.some(value => value.path === "/api/auth/logout" && value.cookie.includes(token))).toBe(true);
    expect(internalCalls.every(value => !value.cookie.includes("unrelated"))).toBe(true);
    expect(browserApiRequests.length).toBeGreaterThan(0);
    expect(browserApiRequests.every(url => new URL(url).origin === "http://127.0.0.1:3001")).toBe(true);
    expect(publicCalls).toBe(0);
  } finally { await close(internal); await close(publicApi); }
});
