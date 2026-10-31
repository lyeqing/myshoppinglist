type Code = "connection_failed" | "request_timeout" | "unexpected_error";
const last = new Map<string, number>();
export function reportDiagnostic(code: Code) {
  if (typeof window === "undefined" || (last.get(code) ?? 0) > Date.now() - 60000) return;
  last.set(code, Date.now());
  const release = process.env.NEXT_PUBLIC_RELEASE && /^[a-zA-Z0-9._-]{1,64}$/.test(process.env.NEXT_PUBLIC_RELEASE) ? process.env.NEXT_PUBLIC_RELEASE : "web";
  // No URL, stack trace, exception text, form data, browser history or identifiers.
  void fetch("/api/diagnostics", { method: "POST", credentials: "same-origin", keepalive: true,
    headers: { "Content-Type": "application/json", "X-MyShoppingList-Request": "1" },
    body: JSON.stringify({ component: "website", code, release }) }).catch(() => {});
}
