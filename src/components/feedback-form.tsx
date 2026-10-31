"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { Session } from "@/lib/api-types";
export type Ticket = { id: string; accountId: number; category: string; message: string; rating: number | null; component: string;
  status: string; response: string | null; issueReference: string | null; hasScreenshot: boolean; version: number; createdAt: string; updatedAt: string };
type Submission = { expectedAccountId: number; requestId: string; category: string; message: string; rating: number | null;
  component: string; screenshot: string | null; screenshotApproved: boolean };
export default function FeedbackForm() {
  const screenshotInput = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session | null>(null), [tickets, setTickets] = useState<Ticket[]>([]);
  const [category, setCategory] = useState("bug"), [message, setMessage] = useState(""), [rating, setRating] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null), [approved, setApproved] = useState(false);
  const [pending, setPending] = useState<Submission | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [available, setAvailable] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    api<Session>("/auth/me", { signal: abort.signal }).then(async value => {
      if (abort.signal.aborted) return; setSession(value);
      const own = await api<Ticket[]>("/feedback", { signal: abort.signal }); if (!abort.signal.aborted) setTickets(own);
    })
      .catch(e => { if (!abort.signal.aborted) { if (e instanceof ApiError && e.status === 404) setAvailable(false);
        else if (e instanceof ApiError && e.status === 401) { setSession(null); setTickets([]); }
        else setError(e instanceof Error ? e.message : "Unable to load feedback."); } });
    const changed = () => { abort.abort(); setSession(null); setTickets([]); setPending(null); setMessage(""); setScreenshot(null); setApproved(false); setNotice(""); setAttempt(v => v + 1); };
    window.addEventListener("myshoppinglist-session-changed", changed);
    return () => { abort.abort(); window.removeEventListener("myshoppinglist-session-changed", changed); };
  }, [attempt]);
  async function attach(file?: File) {
    setError(""); setScreenshot(null); setApproved(false);
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5000000) { setError("Choose a PNG, JPEG or WebP image smaller than 5 MB."); return; }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const png = canvas.toDataURL("image/png").split(",")[1];
      if (png.length > 666664) throw new Error("This screenshot is too large after processing. Crop it and try again.");
      setScreenshot(png);
    } catch (e) { setError(e instanceof Error ? e.message : "The screenshot could not be processed."); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (busy || !session) return;
    const body = pending ?? { expectedAccountId: session.account.id, requestId: crypto.randomUUID(), category, message,
      rating: rating ? Number(rating) : null, component: new URLSearchParams(location.search).get("from") === "extension" ? "extension" : "website", screenshot, screenshotApproved: approved };
    setPending(body); setBusy(true); setError(""); setNotice("");
    try {
      const ticket = await api<Ticket>("/feedback", { method: "POST", body: JSON.stringify(body) });
      setTickets(value => [ticket, ...value.filter(t => t.id !== ticket.id)]); setNotice("Feedback sent. Your private ticket and any support response appear below.");
      setPending(null); setMessage(""); setScreenshot(null); setApproved(false);
      if (screenshotInput.current) screenshotInput.current.value = "";
    } catch (e) {
      if (e instanceof ApiError && [400, 403, 413, 415, 429].includes(e.status)) setPending(null);
      if (e instanceof ApiError && e.status === 401) { setSession(null); setTickets([]); }
      setError(e instanceof Error ? e.message : "Feedback could not be sent. Retry uses the same request safely.");
    }
    finally { setBusy(false); }
  }
  function privacyRequest(kind: "export" | "deletion") {
    const prefix = `Account ${kind} request. Please verify my account ownership and discuss the next steps before taking action.`;
    setCategory("other"); setMessage(value => value.startsWith(prefix) ? value : [prefix, value].filter(Boolean).join("\n\n"));
    document.getElementById("support-message")?.focus();
  }
  return <section className="mt-8" aria-labelledby="feedback-title"><h2 id="feedback-title" className="text-2xl font-semibold">Send private feedback</h2>
    <p className="mt-2 text-slate-600">Report a problem or suggest an improvement. Please leave out passwords, payment details and unrelated personal information. Support can read your message; it is not public.</p>
    {!available ? <p className="mt-4">Feedback is not enabled on this service yet.</p> : !session ? <p className="mt-4"><Link href="/" className="font-semibold text-primary-700 underline">Sign in to MyShoppingList</Link> to send feedback and see your tickets.</p> : <>
      <details className="mt-5 rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Account export or deletion</summary><p className="mt-2 text-sm text-slate-600">These requests are reviewed privately by support. Support verifies ownership and explains retention and delivery before acting. Sending a request does not delete your account.</p><div className="mt-3 flex flex-wrap gap-5"><button disabled={busy || !!pending} onClick={() => privacyRequest("export")} className="min-h-11 font-semibold underline">Prepare an export request</button><button disabled={busy || !!pending} onClick={() => privacyRequest("deletion")} className="min-h-11 font-semibold underline">Prepare a deletion request</button></div></details>
      <form className="mt-5 space-y-4" onSubmit={e => { e.preventDefault(); void submit(); }}><fieldset disabled={busy || !!pending} className="space-y-4">
        <label className="block font-semibold">Feedback type<select value={category} onChange={e => setCategory(e.target.value)} className="mt-2 block w-full rounded-xl border bg-white p-3"><option value="bug">Report a problem</option><option value="suggestion">Suggest an improvement</option><option value="other">Other</option></select></label>
        <label className="block font-semibold">Message<textarea id="support-message" required maxLength={5000} rows={5} value={message} onChange={e => setMessage(e.target.value)} className="mt-2 block w-full rounded-xl border bg-white p-3" /></label>
        <label className="block font-semibold">Rating (optional)<select value={rating} onChange={e => setRating(e.target.value)} className="mt-2 block rounded-xl border bg-white p-3"><option value="">No rating</option>{[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v} out of 5</option>)}</select></label>
        <label className="block font-semibold">Screenshot (optional)<input ref={screenshotInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void attach(e.target.files?.[0])} className="mt-2 block max-w-full text-sm" /></label>
        <p className="text-sm text-slate-600">Choose an image yourself. We never capture your screen automatically. Crop private details first. Images are resized and metadata removed before upload.</p>
        {screenshot && <div><label className="flex items-start gap-3"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} required className="mt-1" />I reviewed this screenshot and agree to share it privately with support.</label><button type="button" onClick={() => { setScreenshot(null); setApproved(false); if (screenshotInput.current) screenshotInput.current.value = ""; }} className="min-h-11 font-semibold underline">Remove screenshot</button></div>}
      </fieldset><button disabled={busy || (!pending && (!message.trim() || !!screenshot && !approved))} className="min-h-11 rounded-xl bg-primary-600 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Sending…" : pending ? "Retry sending feedback" : "Send feedback"}</button>
      {pending && !busy && <p className="text-sm text-slate-600">Your draft is kept unchanged until the service confirms it. Retry to avoid sending it twice.</p>}</form>
      <h3 className="mt-8 text-xl font-semibold">Your recent tickets</h3><button disabled={busy} onClick={() => setAttempt(v => v + 1)} className="min-h-11 font-semibold underline">Refresh tickets</button>
      {!tickets.length && <p>No feedback tickets yet.</p>}<ul className="mt-3 space-y-4">{tickets.map(t => <li key={t.id} className="rounded-xl border bg-white p-4"><p className="font-semibold">{t.category} · {t.status}</p><p className="mt-2 whitespace-pre-wrap">{t.message}</p><p className="mt-2 text-sm text-slate-500">{new Date(t.createdAt).toLocaleString()}</p>{t.response && <div className="mt-3 border-t pt-3"><h4 className="font-semibold">Support response</h4><p className="whitespace-pre-wrap">{t.response}</p></div>}{t.hasScreenshot && <a href={`/api/feedback/${t.id}/screenshot`} className="mt-2 inline-block min-h-11 text-primary-700 underline">Download your screenshot</a>}</li>)}</ul>
    </>}{error && <p role="alert" className="mt-4 text-red-700">{error}</p>}{notice && <p role="status" className="mt-4 text-primary-700">{notice}</p>}
  </section>;
}
