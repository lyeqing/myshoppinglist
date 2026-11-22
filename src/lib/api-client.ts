export class ApiError extends Error { constructor(public status: number, message: string, public retryAfter: number | null = null, public referenceId: string | null = null) { super(message); } }
import { reportDiagnostic } from "./diagnostics";
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const authentication = ["/auth/me", "/auth/login", "/auth/register", "/auth/social/start", "/auth/social/complete"].includes(path);
  const unavailable = () => {
    if (authentication && typeof window !== "undefined" && !init.signal?.aborted)
      window.dispatchEvent(new Event("myshoppinglist-auth-unavailable"));
  };
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  try {
    const response = await fetch(`/api${path}`, { ...init, signal: controller.signal, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", "X-MyShoppingList-Request": "1", "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", ...init.headers } });
    if (!response.ok) {
      const raw = await response.json().catch(error => { if (controller.signal.aborted) throw error; return {}; });
      const problem = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const reference = response.status >= 500 && typeof problem.traceId === "string" && /^[a-zA-Z0-9:_-]{1,80}$/.test(problem.traceId) ? problem.traceId : null;
      const wait = Number(response.headers.get("Retry-After")) || null;
      const message = response.status === 401 ? (path === "/auth/login" ? "The email or password is incorrect." : path === "/auth/register" ? "Your session is unavailable. Clear the expired session before creating a free account." : "Your session has ended. Sign in again to continue.") : response.status === 429 ? `Too many requests. Please try again${wait ? ` in ${wait} seconds` : " shortly"}.` : response.status >= 500 ? "The service is temporarily unavailable. Please try again." : problem.title ?? "This request could not be completed.";
      throw new ApiError(response.status, reference ? `${message} Reference: ${reference}.` : message, wait, reference);
    }
    const value = response.status === 204 ? undefined : await response.json();
    if (["/auth/me", "/auth/login", "/auth/register"].includes(path) &&
      (!value || typeof value.account?.id !== "number" || typeof value.account?.displayName !== "string" ||
        typeof value.account?.isTrial !== "boolean" || typeof value.sessionExpiresDate !== "string" ||
        !Number.isFinite(Date.parse(value.sessionExpiresDate)))) {
      throw new ApiError(502, "The account service returned an unexpected response. Please try again later.");
    }
    return value as T;
  } catch (error) {
    if (init.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (timedOut) { unavailable(); reportDiagnostic("request_timeout"); throw new ApiError(0, "This request took too long. Please try again."); }
    if (error instanceof ApiError) {
      if (error.status >= 500 || error.status === 404 || error.status === 405 ||
        (path === "/auth/me" && error.status !== 401 && error.status !== 429)) unavailable();
      throw error;
    }
    unavailable();
    reportDiagnostic("connection_failed");
    throw new ApiError(0, "We couldn’t connect. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}
