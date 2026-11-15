import { NextRequest } from "next/server";
const cookieName = "myshoppinglist_session";
const reply = (status: number, title: string) => {
  const traceId = status >= 500 ? crypto.randomUUID() : undefined;
  if (traceId) console.error(JSON.stringify({ event: "gateway_request_failed", status, traceId }));
  return Response.json(
    { title, ...(traceId ? { traceId } : {}) },
    { status, headers: { "Cache-Control": "no-store" } },
  );
};
async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const route = path.join("/");
  const get = request.method === "GET";
  const account = route === "auth/register" || route === "auth/login";
  const credentials = request.method === "POST" && ["auth/recovery/request", "auth/recovery/complete", "auth/password"].includes(route)
    || get && route === "auth/recovery";
  const reset = route === "auth/reset-expired";
  const edit =
    request.method === "PUT" &&
    /^shopping-lists\/[1-9]\d{0,18}\/items\/[1-9]\d{0,18}$/.test(route);
  const remove =
    request.method === "DELETE" &&
    /^shopping-lists\/[1-9]\d{0,18}\/items\/[1-9]\d{0,18}$/.test(route);
  const adminGet =
    get && /^admin\/accounts(?:\/[1-9]\d{0,18}\/review)?$/.test(route);
  const adminEdit =
    request.method === "PUT" && /^admin\/accounts\/[1-9]\d{0,18}$/.test(route);
  const alternativeSearch =
    get && route === "admin/product-alternatives/products";
  const alternativeReview =
    (get || request.method === "PUT") &&
    /^admin\/product-alternatives\/[1-9]\d{0,18}\/[1-9]\d{0,18}$/.test(route);
  const branchCollection = route === "admin/shop-locations";
  const branchDetail = /^admin\/shop-locations\/[1-9]\d{0,18}$/.test(route);
  const branchWrite =
    (branchCollection && request.method === "POST") ||
    (branchDetail && request.method === "PUT");
  const customerBranchSearch = get && route === "shop-locations";
  const branchSearch = (branchCollection && get) || customerBranchSearch;
  const preferences = route === "account/shopping-preferences";
  const currentList = route === "account/current-list" && (get || request.method === "PUT");
  const extensionDevices = get && route === "account/extension-devices" || request.method === "DELETE" && /^account\/extension-devices\/[a-fA-F0-9-]{36}$/.test(route);
  const operations = get && (route === "admin/session" || route === "admin/operations" || route === "admin/operations/feedback" || /^admin\/operations\/account\/[1-9]\d{0,18}$/.test(route))
    || request.method === "PUT" && /^admin\/operations\/feedback\/[a-fA-F0-9-]{36}$/.test(route)
    || request.method === "POST" && route === "admin/operations/simulate-incident";
  const feedback = route === "feedback" && (get || request.method === "POST");
  const screenshot = get && /^(?:feedback|admin\/operations\/feedback)\/[a-fA-F0-9-]{36}\/screenshot$/.test(route);
  const analytics = request.method === "POST" && ["analytics/events", "analytics/forget", "diagnostics"].includes(route);
  const billing = get && (route === "billing" || route === "admin/billing") || request.method === "POST" && (route === "billing/checkout" || route === "billing/portal");
  const oauth = request.method === "POST" && (route === "ai/oauth/preview" || route === "ai/oauth/authorize");
  const connections = (get && (route === "ai/connections" || route === "ai/connection-info")) || (request.method === "DELETE" && /^ai\/connections\/[a-fA-F0-9-]{36}$/.test(route));
  const research = get && /^(?:research(?:\/[a-fA-F0-9-]{36}|\/instructions|\/refresh\/[1-9]\d{0,18})?)$/.test(route)
    || request.method === "POST" && /^(?:research(?:\/select|\/generic\/[1-9]\d{0,18})?)$/.test(route)
    || request.method === "PUT" && /^research\/issues\/[a-fA-F0-9-]{36}$/.test(route);
  const discovery =
    /^shopping-lists\/[1-9]\d{0,18}(?:\/items\/[1-9]\d{0,18})?\/(?:pack-discovery|brand-discovery)$/.test(
      route,
    );
  const productLibrary = get && route === "account/products";
  const productPreferences = get && route === "account/products/preferences";
  const productPreferenceWrite = request.method === "PUT" && /^account\/products\/[1-9]\d{0,18}\/preferences$/.test(route);
  const savedProductAdd = request.method === "POST" && /^shopping-lists\/[1-9]\d{0,18}\/products\/[1-9]\d{0,18}$/.test(route);
  const substitution = request.method === "PUT" && /^shopping-lists\/[1-9]\d{0,18}\/items\/[1-9]\d{0,18}\/substitutions\/[1-9]\d{0,18}$/.test(route);
  const allowed =
    research || credentials || billing || currentList || extensionDevices || operations || feedback || screenshot || analytics || oauth || connections ||
    substitution ||
    productLibrary || productPreferences || productPreferenceWrite || savedProductAdd ||
    branchWrite ||
    branchSearch ||
    (branchDetail && get) ||
    alternativeSearch ||
    alternativeReview ||
    (discovery && (get || request.method === "POST")) ||
    (preferences && (get || request.method === "PUT")) ||
    (get && route === "admin/health") ||
    (request.method === "POST" &&
      /^shopping-lists\/[1-9]\d{0,18}\/items\/[1-9]\d{0,18}\/(retry-comparison|refresh-prices)$/.test(
        route,
      )) ||
    (get &&
      /^shopping-lists\/(manage|history|[1-9]\d{0,18}\/history)$/.test(
        route,
      )) ||
    (request.method === "POST" &&
      /^(shopping-lists|shopping-lists\/[1-9]\d{0,18}\/archive)$/.test(
        route,
      )) ||
    (request.method === "DELETE" &&
      /^shopping-lists\/[1-9]\d{0,18}$/.test(route)) ||
    adminGet ||
    adminEdit ||
    (get
      ? /^(shopping-lists|auth\/me|product-import-jobs\/[1-9]\d{0,18}|shopping-lists\/[1-9]\d{0,18}\/(imports|items|in-store|plan))$/.test(
          route,
        )
      : edit ||
        remove ||
        (request.method === "POST" &&
          /^(auth\/(trial|logout|register|login|reset-expired)|shopping-lists\/[1-9]\d{0,18}\/(products\/url|refresh-prices))$/.test(
            route,
          )));
  if (!allowed) return reply(404, "This route is unavailable.");
  try {
    const upstream = new URL(
      process.env.MYSHOPPINGLIST_API_URL ?? "http://localhost:5392",
    );
    if (
      !["http:", "https:"].includes(upstream.protocol) ||
      upstream.username ||
      upstream.password ||
      upstream.pathname !== "/"
    )
      return reply(503, "The service is not configured correctly.");
    const publicOrigin = new URL(
      process.env.MYSHOPPINGLIST_PUBLIC_ORIGIN ?? request.url,
    ).origin;
    if (
      !get &&
      (request.headers.get("X-MyShoppingList-Request") !== "1" ||
        request.headers.get("Sec-Fetch-Site") === "cross-site" ||
        (request.headers.has("Origin") &&
          request.headers.get("Origin") !== publicOrigin))
    )
      return reply(403, "The request failed browser request protection.");
    const target = new URL(`/api/${route}`, upstream);
    if (research && get) {
      for (const [key, value] of request.nextUrl.searchParams) {
        if (!route.startsWith("research/refresh/") || key !== "pageSize" || request.nextUrl.searchParams.getAll(key).length !== 1
          || !/^(?:[1-9]|[1-4]\d|50)$/.test(value)) return reply(400, "Invalid research filters.");
        target.searchParams.set(key, value);
      }
    }
    if (get && route === "admin/operations/feedback") {
      const status = request.nextUrl.searchParams.get("status");
      if (status && !["new", "triaged", "planned", "resolved", "closed"].includes(status)) return reply(400, "Invalid feedback status.");
      if (status) target.searchParams.set("status", status);
    }
    if (productLibrary || productPreferences) {
      const query = request.nextUrl.searchParams;
      const keys = productLibrary ? ["view", "filter", "search", "offset", "pageSize"] : ["productIds", "expectedAccountId"];
      if ([...query.keys()].some((key) => !keys.includes(key) || query.getAll(key).length !== 1)) return reply(400, "Invalid product filters.");
      for (const [key, value] of query) {
        if (value.length > 1000 || key === "search" && value.length > 100 || ["offset", "pageSize", "expectedAccountId"].includes(key) && !/^\d{1,19}$/.test(value)) return reply(400, "Invalid product filters.");
        target.searchParams.set(key, value);
      }
    }
    if (get && (route.endsWith("/imports") || route.endsWith("/items")))
      for (const key of ["beforeId", "pageSize"]) {
        const values = request.nextUrl.searchParams.getAll(key);
        if (values.length > 1 || (values[0] && !/^\d{1,19}$/.test(values[0])))
          return reply(400, "Invalid pagination parameters.");
        if (values[0]) target.searchParams.set(key, values[0]);
      }
    if (get && route.endsWith("/items"))
      for (const key of ["includeHidden", "includePurchased"]) {
        const values = request.nextUrl.searchParams.getAll(key);
        if (
          values.length > 1 ||
          (values.length === 1 && !["true", "false"].includes(values[0]))
        )
          return reply(400, "Invalid list filters.");
        if (values.length) target.searchParams.set(key, values[0]);
      }
    if (adminGet && route === "admin/accounts") {
      const search = request.nextUrl.searchParams.get("search") ?? "";
      if (search.length > 320) return reply(400, "Search is too long.");
      target.searchParams.set("search", search);
      const state = request.nextUrl.searchParams.get("state");
      if (state && !["trial", "free", "paid", "suspended"].includes(state)) return reply(400, "Invalid account filter.");
      if (state) target.searchParams.set("state", state);
    }
    if (alternativeSearch) {
      const values = request.nextUrl.searchParams.getAll("search");
      if (
        values.length !== 1 ||
        values[0].length > 100 ||
        [...request.nextUrl.searchParams.keys()].some((key) => key !== "search")
      )
        return reply(
          400,
          "Send one product search value of at most 100 characters.",
        );
      target.searchParams.set("search", values[0]);
    }
    if (branchSearch) {
      const query = request.nextUrl.searchParams;
      if (
        [...query.keys()].some((key) => key !== "shopId" && key !== "search") ||
        query.getAll("shopId").length > 1 ||
        query.getAll("search").length > 1
      )
        return reply(400, "Send each branch search filter once.");
      const shopId = query.get("shopId");
      const search = query.get("search") ?? "";
      if (
        (shopId !== null && !/^[1-9]\d{0,18}$/.test(shopId)) ||
        search.length > 100
      )
        return reply(
          400,
          "Send a valid retailer and a search of at most 100 characters.",
        );
      if (shopId !== null) target.searchParams.set("shopId", shopId);
      if (query.has("search")) target.searchParams.set("search", search);
    }
    const headers = new Headers({
      Accept: "application/json",
      "X-MyShoppingList-Request": "1",
    });
    if (research && request.headers.has("X-MyShoppingList-Account")) {
      const expectedAccount = request.headers.get("X-MyShoppingList-Account")!;
      if (!/^[1-9]\d{0,18}$/.test(expectedAccount)) return reply(400, "Invalid account context.");
      headers.set("X-MyShoppingList-Account", expectedAccount);
    }
    const timezone = request.headers.get("X-Client-Timezone");
    if (timezone && timezone.length <= 100)
      headers.set("X-Client-Timezone", timezone);
    const session = request.cookies.get(cookieName)?.value;
    if (session && /^[a-f0-9]{64}$/.test(session))
      headers.set("Cookie", `${cookieName}=${session}`);
    let body: string | undefined;
    if (!get) {
      if (
        (research || account || oauth || currentList || feedback || operations || analytics ||
          productPreferenceWrite || savedProductAdd ||
          preferences ||
          alternativeReview ||
          branchWrite ||
          discovery ||
          substitution ||
          edit ||
          remove ||
          route.endsWith("/products/url")) &&
        request.headers.get("Content-Type")?.split(";")[0] !==
          "application/json"
      )
        return reply(415, "Send a JSON request.");
      const reader = request.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let size = 0;
        body = "";
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (
            size >
            (research && route === "research" ? 65536 : feedback ? 750000 : operations ? 10000 : edit
              ? 32768
              : alternativeReview || branchWrite || account || credentials || preferences
                ? 16384
                : 4096)
          ) {
            await reader.cancel();
            return reply(413, "The request is too large.");
          }
          body += decoder.decode(part.value, { stream: true });
        }
        body += decoder.decode();
      }
      headers.set("Content-Type", "application/json");
      if (oauth) {
        try {
          const value = JSON.parse(body ?? "");
          const fields = route.endsWith("/preview") ? ["request_uri", "client_id"] : ["request_uri", "client_id", "expected_account_id", "decision", "approved_scopes"];
          if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => typeof value[key] !== "string" || value[key].length > 2048))
            return reply(400, "This connection request is invalid. Start again from your AI app.");
          body = new URLSearchParams(value).toString();
          headers.set("Content-Type", "application/x-www-form-urlencoded");
        } catch { return reply(400, "Send a valid connection request."); }
      }
      // Browser origin was validated above; the internal request has the API's own origin.
      headers.set("Origin", upstream.origin);
      if (account) {
        try {
          const value = JSON.parse(body ?? "");
          if (!value || typeof value !== "object" || Array.isArray(value))
            return reply(400, "Send a JSON object.");
        } catch {
          return reply(400, "Send valid JSON.");
        }
      }
    }
    if (reset) {
      const check = await fetch(new URL("/api/auth/me", upstream), {
        headers,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      });
      if (check.ok)
        return reply(
          409,
          "Your session is still active. Keep your list or sign out first.",
        );
      if (check.status !== 401)
        return reply(502, "We could not check your session. Please try again.");
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${publicOrigin.startsWith("https:") ? "; Secure" : ""}`,
        },
      });
    }
    const result = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    if (route === "ai/oauth/authorize" && result.status === 302) {
      const location = result.headers.get("Location");
      if (!location) return reply(502, "The connection could not be completed.");
      const callback = new URL(location);
      if (!["https:", "http:"].includes(callback.protocol) || callback.username || callback.password || callback.hash)
        return reply(502, "The connection callback is invalid.");
      return Response.json({ redirectUrl: callback.toString() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (oauth && !result.ok) {
      if (result.status === 401) return reply(401, "Sign in to review this connection.");
      if (result.status === 409) return reply(409, "Your account changed. Review the connection again.");
      return reply(result.status, "This connection request is unavailable or expired. Start again from your AI app.");
    }
    if (result.status >= 300 && result.status < 400)
      return reply(502, "The service could not complete this request.");
    if (screenshot && result.ok) return new Response(await result.arrayBuffer(), { status: 200, headers: {
      "Cache-Control": "no-store", "Content-Type": "image/png", "Content-Disposition": "attachment; filename=feedback-screenshot.png", "X-Content-Type-Options": "nosniff",
    } });
    const outgoing = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    });
    for (const name of ["Retry-After", "Location"]) {
      const value = result.headers.get(name);
      if (value && (name !== "Location" || value.startsWith("/api/")))
        outgoing.set(name, value);
    }
    for (const value of result.headers.getSetCookie())
      if (value.startsWith(`${cookieName}=`)) {
        const cookie = value.replace(/;\s*domain=[^;]*/gi, "");
        outgoing.append(
          "Set-Cookie",
          publicOrigin.startsWith("https:") &&
            !/;\s*secure(?:;|$)/i.test(cookie)
            ? `${cookie}; Secure`
            : cookie,
        );
      }
    return new Response(result.status === 204 ? null : await result.text(), {
      status: result.status,
      headers: outgoing,
    });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499, headers: { "Cache-Control": "no-store" } });
    return reply(
      502,
      "The service is temporarily unavailable. Please try again.",
    );
  }
}
export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
