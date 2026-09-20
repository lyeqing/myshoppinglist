import { NextRequest } from "next/server";
const cookieName = "myshoppinglist_session";
const reply = (status: number, title: string) => Response.json({ title }, { status, headers: { "Cache-Control": "no-store" } });
async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join("/");
  const get = request.method === "GET";
  const edit = request.method === "PUT" && /^shopping-lists\/[1-9]\d{0,18}\/items\/[1-9]\d{0,18}$/.test(route);
  const allowed = get ? /^(auth\/me|product-import-jobs\/[1-9]\d{0,18}|shopping-lists\/[1-9]\d{0,18}\/(imports|items))$/.test(route)
    : edit || request.method === "POST" && /^(auth\/(trial|logout)|shopping-lists\/[1-9]\d{0,18}\/products\/url)$/.test(route);
  if (!allowed) return reply(404, "This route is unavailable.");
  try {
    const upstream = new URL(process.env.MYSHOPPINGLIST_API_URL ?? "http://localhost:5392");
    if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== "/") return reply(503, "The service is not configured correctly.");
    const publicOrigin = new URL(process.env.MYSHOPPINGLIST_PUBLIC_ORIGIN ?? request.url).origin;
    if (!get && (request.headers.get("X-MyShoppingList-Request") !== "1" || request.headers.get("Sec-Fetch-Site") === "cross-site"
      || (request.headers.has("Origin") && request.headers.get("Origin") !== publicOrigin))) return reply(403, "The request failed browser request protection.");
    const target = new URL(`/api/${route}`, upstream);
    if (get && (route.endsWith("/imports") || route.endsWith("/items"))) for (const key of ["beforeId", "pageSize"]) {
      const values = request.nextUrl.searchParams.getAll(key);
      if (values.length > 1 || (values[0] && !/^\d{1,19}$/.test(values[0]))) return reply(400, "Invalid pagination parameters.");
      if (values[0]) target.searchParams.set(key, values[0]);
    }
    if (get && route.endsWith("/items")) for (const key of ["includeHidden", "includePurchased"]) {
      const values = request.nextUrl.searchParams.getAll(key);
      if (values.length > 1 || values.length === 1 && !["true", "false"].includes(values[0])) return reply(400, "Invalid list filters.");
      if (values.length) target.searchParams.set(key, values[0]);
    }
    const headers = new Headers({ "Accept": "application/json", "X-MyShoppingList-Request": "1" });
    const session = request.cookies.get(cookieName)?.value;
    if (session && /^[a-f0-9]{64}$/.test(session)) headers.set("Cookie", `${cookieName}=${session}`);
    let body: string | undefined;
    if (!get) {
      if ((edit || route.endsWith("/products/url")) && request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return reply(415, "Send a JSON request.");
      const reader = request.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder(); let size = 0; body = "";
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
          if (size > (edit ? 32768 : 4096)) { await reader.cancel(); return reply(413, "The request is too large."); }
          body += decoder.decode(part.value, { stream: true });
        }
        body += decoder.decode();
      }
      headers.set("Content-Type", "application/json");
      // Browser origin was validated above; the internal request has the API's own origin.
      headers.set("Origin", upstream.origin);
    }
    const result = await fetch(target, { method: request.method, headers, body, redirect: "manual", cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
    if (result.status >= 300 && result.status < 400) return reply(502, "The service could not complete this request.");
    const outgoing = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json" });
    for (const name of ["Retry-After", "Location"]) { const value = result.headers.get(name); if (value && (name !== "Location" || value.startsWith("/api/"))) outgoing.set(name, value); }
    for (const value of result.headers.getSetCookie()) if (value.startsWith(`${cookieName}=`)) {
      const cookie = value.replace(/;\s*domain=[^;]*/gi, "");
      outgoing.append("Set-Cookie", publicOrigin.startsWith("https:") && !/;\s*secure(?:;|$)/i.test(cookie) ? `${cookie}; Secure` : cookie);
    }
    return new Response(result.status === 204 ? null : await result.text(), { status: result.status, headers: outgoing });
  } catch { return reply(502, "The service is temporarily unavailable. Please try again."); }
}
export const GET = forward;
export const POST = forward;
export const PUT = forward;
