"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
type Preference = { allowed: boolean; visitorId?: string; expiresAt: number };
const key = "myshoppinglist-analytics-consent";
const pages: Record<string, string> = { "/": "landing", "/extension": "extension", "/features": "features", "/faq": "faq", "/how-it-works": "how_it_works", "/pricing": "pricing", "/support": "support" };
function read(): Preference | null {
  try { const value = JSON.parse(localStorage.getItem(key) || "null");
    if (value && (value.expiresAt <= Date.now() || !value.allowed)) {
      sessionStorage.removeItem("myshoppinglist-analytics-session"); sessionStorage.removeItem("myshoppinglist-analytics-source");
      if (value.expiresAt <= Date.now()) localStorage.removeItem(key);
    }
    return value && typeof value.allowed === "boolean" && value.expiresAt > Date.now() ? value : null;
  } catch { return null; }
}
async function forget(visitorId?: string) {
  if (!visitorId) return;
  try { await fetch("/api/analytics/forget", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-MyShoppingList-Request": "1" }, body: JSON.stringify({ visitorId }) }); }
  catch { /* Server retention still removes raw events after 30 days. */ }
}
export default function AnalyticsPreferences() {
  const pathname = usePathname();
  const [preference, setPreference] = useState<Preference | null>(null), [ready, setReady] = useState(false), [editing, setEditing] = useState(false);
  useEffect(() => {
    const value = read();
    Promise.resolve().then(() => { setPreference(value); setReady(true); });
    const changed = (event: StorageEvent) => { if (event.key === key) setPreference(read()); };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    const page = pages[pathname];
    if (!preference?.allowed || !preference.visitorId || !page || preference.expiresAt <= Date.now()) return;
    const visitorId = preference.visitorId;
    const report = (name: string) => {
      // Read again for every event: withdrawing in another tab takes effect immediately.
      if (!read()?.allowed) return;
      try {
        let sessionId = sessionStorage.getItem("myshoppinglist-analytics-session");
        if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem("myshoppinglist-analytics-session", sessionId); }
        const raw = new URLSearchParams(location.search).get("utm_source");
        if (raw && /^[a-zA-Z0-9._-]{1,80}$/.test(raw)) sessionStorage.setItem("myshoppinglist-analytics-source", raw);
        const remembered = sessionStorage.getItem("myshoppinglist-analytics-source");
        const attribution = remembered && /^[a-zA-Z0-9._-]{1,80}$/.test(remembered) ? remembered : null;
        void fetch("/api/analytics/events", { method: "POST", credentials: "same-origin", keepalive: true,
          headers: { "Content-Type": "application/json", "X-MyShoppingList-Request": "1" },
          body: JSON.stringify({ eventId: crypto.randomUUID(), visitorId, sessionId, name, page, attribution, consent: true }) }).catch(() => {});
      } catch { /* Analytics is optional and must never block shopping. */ }
    };
    report("page_view");
    const click = (event: MouseEvent) => { if ((event.target as Element)?.closest?.("[data-analytics-cta]")) report("cta_click"); };
    const signup = () => report("signup_complete");
    const signupStart = () => report("signup_start");
    window.addEventListener("click", click); window.addEventListener("myshoppinglist-signup-completed", signup);
    window.addEventListener("myshoppinglist-signup-started", signupStart);
    return () => { window.removeEventListener("click", click); window.removeEventListener("myshoppinglist-signup-completed", signup); window.removeEventListener("myshoppinglist-signup-started", signupStart); };
  }, [pathname, preference]);
  async function choose(allowed: boolean) {
    const previous = read();
    const value = { allowed, ...(allowed ? { visitorId: previous?.visitorId || crypto.randomUUID() } : {}), expiresAt: Date.now() + 30 * 86400000 };
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Still apply this tab's choice. */ }
    setPreference(value); setEditing(false);
    if (!allowed) { sessionStorage.removeItem("myshoppinglist-analytics-session"); sessionStorage.removeItem("myshoppinglist-analytics-source"); await forget(previous?.visitorId); }
  }
  if (!ready || pathname !== "/privacy") return null;
  return <aside id="analytics-preferences" aria-label="Analytics privacy" className="mx-auto max-w-5xl px-5 py-6 text-sm text-slate-600">
    <h2 className="mb-3 text-xl font-semibold text-slate-900">Analytics preferences</h2>
    {!preference || editing ? <><p>Optional analytics helps us understand visits and signup. We record fixed page and action names, random visitor/session identifiers and a limited campaign source; no list contents, product URLs or unrelated browsing. While signed in, consented events may be associated with your account for activation measurements. Raw events expire after 30 days and anonymous daily totals after 12 months.</p><div className="mt-3 flex flex-wrap gap-5"><button onClick={() => void choose(false)} className="min-h-11 rounded-lg border px-4 font-semibold">Decline analytics</button><button onClick={() => void choose(true)} className="min-h-11 rounded-lg border px-4 font-semibold">Allow optional analytics</button></div></> : <button onClick={() => setEditing(true)} className="min-h-11 underline">Analytics preferences · {preference.allowed ? "allowed" : "declined"}</button>}
  </aside>;
}
