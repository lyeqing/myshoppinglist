"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { Ticket } from "./feedback-form";
const states = ["new", "triaged", "planned", "resolved", "closed"];
function Editor({ ticket, saved }: { ticket: Ticket; saved: () => void }) {
  const [status, setStatus] = useState(ticket.status), [response, setResponse] = useState(ticket.response || ""), [issue, setIssue] = useState(ticket.issueReference || ""), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try { await api(`/admin/operations/feedback/${ticket.id}`, { method: "PUT", body: JSON.stringify({ expectedVersion: ticket.version, status, response, issueReference: issue, reason }) }); saved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to update this ticket."); } finally { setBusy(false); }
  }
  return <article className="rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">{ticket.category} · Account {ticket.accountId}</h2><p className="mt-2 text-sm text-slate-500">{new Date(ticket.createdAt).toLocaleString()} · {ticket.component} · {ticket.rating ? `${ticket.rating}/5` : "No rating"}</p><p className="mt-4 whitespace-pre-wrap">{ticket.message}</p>{ticket.hasScreenshot && <a href={`/api/admin/operations/feedback/${ticket.id}/screenshot`} className="mt-3 inline-block min-h-11 font-semibold text-primary-700 underline">Download approved screenshot</a>}
    <form onSubmit={e => { e.preventDefault(); void save(); }} className="mt-4 space-y-3"><fieldset disabled={busy} className="space-y-3"><label className="block">Ticket status<select aria-label="Ticket status" value={status} onChange={e => setStatus(e.target.value)} className="ml-3 rounded border bg-white p-2">{states.map(s => <option key={s}>{s}</option>)}</select></label><label className="block">Response visible to customer<textarea maxLength={2000} rows={3} value={response} onChange={e => setResponse(e.target.value)} className="mt-2 block w-full rounded border p-2" /></label><label className="block">Issue reference (internal)<input maxLength={120} value={issue} onChange={e => setIssue(e.target.value)} className="mt-2 block w-full rounded border p-2" /></label><label className="block">Review reason (internal)<input required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} className="mt-2 block w-full rounded border p-2" /></label><button disabled={!reason.trim()} className="min-h-11 rounded-xl bg-primary-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save ticket review"}</button></fieldset></form>{error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
  </article>;
}
export default function FeedbackInbox() {
  const [status, setStatus] = useState("new"), [tickets, setTickets] = useState<Ticket[]>([]), [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    api<Ticket[]>(`/admin/operations/feedback${status ? `?status=${status}` : ""}`, { signal: abort.signal }).then(value => { setTickets(value); setError(""); })
      .catch(e => { if (!abort.signal.aborted) { setTickets([]); setError(e instanceof Error ? e.message : "Unable to load the inbox."); } })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    const changed = () => { abort.abort(); setTickets([]); setError("Your account changed. Reload to verify administrator access."); };
    window.addEventListener("myshoppinglist-session-changed", changed); return () => { abort.abort(); window.removeEventListener("myshoppinglist-session-changed", changed); };
  }, [status, attempt]);
  return <main className="mx-auto max-w-4xl space-y-5 px-5 py-8"><h1 className="text-3xl font-semibold">Feedback inbox</h1><p className="text-slate-600">Private support messages. Reviews and screenshot downloads are audited. Responses stay in the customer&apos;s ticket; they are not emailed.</p><label className="block">Filter status<select value={status} onChange={e => { setLoading(true); setStatus(e.target.value); }} className="ml-3 rounded border bg-white p-2"><option value="">All statuses</option>{states.map(s => <option key={s}>{s}</option>)}</select></label><button onClick={() => { setLoading(true); setAttempt(v => v + 1); }} className="min-h-11 font-semibold underline">Refresh inbox</button>{loading && <p role="status">Loading feedback…</p>}{error && <p role="alert" className="text-red-700">{error}</p>}{!loading && !error && !tickets.length && <p>No matching feedback tickets.</p>}{tickets.map(t => <Editor key={`${t.id}-${t.version}`} ticket={t} saved={() => { setLoading(true); setAttempt(v => v + 1); }} />)}<p className="text-sm text-slate-500">Showing up to 100 recent tickets. Filter by status to narrow the inbox.</p></main>;
}
