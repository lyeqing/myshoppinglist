import type { Page } from "@playwright/test";
import { createServer } from "node:http";
export async function adminCookie(page: Page) {
  await page.context().addCookies([{ name: "myshoppinglist_session", value: "a".repeat(64), url: "http://127.0.0.1:3001", httpOnly: true, sameSite: "Lax" }]);
}
// For browser-route fixtures that previously had no upstream server. The real
// authorization boundary is exercised separately by operations-journey.spec.ts.
export async function adminSessionServer() {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.statusCode = request.url === "/api/admin/session" && request.headers.cookie?.includes("myshoppinglist_session=" + "a".repeat(64)) ? 200 : 404;
    response.end(JSON.stringify({ administrator: response.statusCode === 200 }));
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(5499, "127.0.0.1", done); });
  return () => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
}
