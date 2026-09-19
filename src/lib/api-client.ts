export class ApiError extends Error { constructor(public status: number, message: string, public retryAfter: number | null = null) { super(message); } }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...init, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", "X-MyShoppingList-Request": "1", ...init.headers } }); }
  catch (error) { if (error instanceof Error && error.name === "AbortError") throw error; throw new ApiError(0, "We couldn’t connect. Check your connection and try again."); }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    const wait = Number(response.headers.get("Retry-After")) || null;
    const message = response.status === 401 ? "Your trial has ended. Start a new trial to continue." : response.status === 429 ? `Too many requests. Please try again${wait ? ` in ${wait} seconds` : " shortly"}.` : response.status >= 500 ? "The service is temporarily unavailable. Please try again." : problem.title ?? "This request could not be completed.";
    throw new ApiError(response.status, message, wait);
  }
  return response.status === 204 ? undefined as T : response.json();
}
