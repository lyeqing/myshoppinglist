"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
type Journey = { firstList: string | null; firstSavedItem: string | null; firstExtensionLink: string | null; firstRecordedRegistration: string | null; firstExtensionCapture: string | null;
  events: { createdAt: string; component: string; name: string; outcome: string; fingerprint: string; traceId: string | null; statusCode: number; durationMs: number; release: string }[] };
export default function AccountJourney({ id }: { id: string }) {
  const [data, setData] = useState<Journey | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    api<Journey>(`/admin/operations/account/${id}`, { signal: abort.signal }).then(value => { setData(value); setError(""); })
      .catch(e => { if (!abort.signal.aborted) { setData(null); setError(e instanceof Error ? e.message : "Unable to load this journey."); } });
    const changed = () => { abort.abort(); setData(null); setError("Your account changed. Reload to verify administrator access."); };
    window.addEventListener("myshoppinglist-session-changed", changed); return () => { abort.abort(); window.removeEventListener("myshoppinglist-session-changed", changed); };
  }, [id, attempt]);
  return <main className="mx-auto max-w-5xl space-y-5 px-5 py-8"><h1 className="text-3xl font-semibold">Account {id} · limited journey</h1><p className="text-slate-600">Audited support view. Events contain fixed action/error categories and correlation identifiers, without list contents, product URLs or unrelated browsing. Landing activity is included only with optional visitor consent.</p><button onClick={() => setAttempt(v => v + 1)} className="min-h-11 font-semibold underline">Refresh journey</button>{error && <p role="alert" className="text-red-700">{error}</p>}{!data && !error && <p role="status">Loading journey…</p>}{data && <><dl className="space-y-3">{[["Recorded registration (retained events)", data.firstRecordedRegistration], ["First list", data.firstList], ["First saved item", data.firstSavedItem], ["First extension link", data.firstExtensionLink], ["First extension capture", data.firstExtensionCapture]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><dt className="font-semibold">{label}</dt><dd>{value ? new Date(value).toLocaleString() : "Not recorded"}</dd></div>)}</dl><h2 className="text-xl font-semibold">Recent operational events</h2>{!data.events.length && <p>No retained events. Instrumentation may be disabled, consent absent, or retention elapsed.</p>}<ol className="space-y-3">{data.events.map((e, i) => <li key={i} className="rounded-xl border bg-white p-4"><p className="font-semibold">{e.component} · {e.name.replaceAll("_", " ")} · {e.outcome}</p><p className="mt-1 text-sm text-slate-600">{new Date(e.createdAt).toLocaleString()} · HTTP {e.statusCode || "n/a"} · {e.durationMs} ms · {e.release}</p><p className="mt-1 break-all text-sm">{e.fingerprint}{e.traceId ? ` · Trace ${e.traceId}` : ""}</p></li>)}</ol></>}</main>;
}
