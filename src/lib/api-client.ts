export class ApiError extends Error { constructor(public status: number, message: string, public retryAfter: number | null = null) { super(message); } }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  try {
    const response = await fetch(`/api${path}`, { ...init, signal: controller.signal, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", "X-MyShoppingList-Request": "1", "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", ...init.headers } });
    if (!response.ok) {
      const problem = await response.json().catch(error => { if (controller.signal.aborted) throw error; return {}; });
      const wait = Number(response.headers.get("Retry-After")) || null;
      const message = response.status === 401 ? (path === "/auth/login" ? "The email or password is incorrect." : path === "/auth/register" ? "Your session is unavailable. An expired trial cannot be saved." : "Your session has ended. Sign in again or start a new trial.") : response.status === 429 ? `Too many requests. Please try again${wait ? ` in ${wait} seconds` : " shortly"}.` : response.status >= 500 ? "The service is temporarily unavailable. Please try again." : problem.title ?? "This request could not be completed.";
      throw new ApiError(response.status, message, wait);
    }
    return response.status === 204 ? undefined as T : await response.json();
  } catch (error) {
    if (init.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (timedOut) throw new ApiError(0, "This request took too long. Please try again.");
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, "We couldn’t connect. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}
