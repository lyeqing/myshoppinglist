"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { Session } from "@/lib/api-types";
import AppHeader from "./app-header";
import CurrentListSelection from "./current-list-selection";
import ExtensionDevices from "./extension-devices";
import { scopeLabels } from "./ai-consent";

type Connection = { id: string; clientName: string; scopes: string[]; connectedAt: string; lastUsedAt: string | null; revokedAt: string | null };
export default function AiConnections() {
  const [session, setSession] = useState<Session | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [resource, setResource] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<Session>("/auth/me", { signal: controller.signal }).then(async current => {
      setSession(current);
      if (!current.account.isTrial) {
        const [grants, info] = await Promise.all([api<Connection[]>("/ai/connections", { signal: controller.signal }), api<{ resource: string }>("/ai/connection-info", { signal: controller.signal })]);
        setConnections(grants); setResource(info.resource);
      }
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof ApiError && e.status === 404 ? "AI connections are not enabled for this service yet." : e instanceof Error ? e.message : "Unable to load your connections."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const changed = () => { controller.abort(); setSession(null); setConnections([]); setResource(""); setError(""); setLoading(true); setAttempt(value => value + 1); };
    window.addEventListener("myshoppinglist-session-changed", changed);
    return () => { controller.abort(); window.removeEventListener("myshoppinglist-session-changed", changed); };
  }, [attempt]);
  async function revoke(id: string) {
    if (busy) return;
    setBusy(id); setError("");
    try { await api<void>(`/ai/connections/${id}`, { method: "DELETE" }); setConnections(value => value.map(c => c.id === id ? { ...c, revokedAt: new Date().toISOString() } : c)); setConfirm(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to revoke access. Please try again."); }
    finally { setBusy(null); }
  }
  return <div className="min-h-screen bg-slate-50"><AppHeader session={session} active="stores" loading={loading} disabled={!!busy} /><main className="mx-auto max-w-3xl px-5 py-8">
    <h1 className="text-3xl font-semibold">Connected AI apps</h1>
    <p className="mt-3 text-slate-600">You control which apps can access your account. Revoking a connection immediately stops future access, including renewal tokens. It cannot remove data already received by the app.</p>
    {loading && <p role="status" className="mt-5">Loading your connections…</p>}
    {error && <div className="mt-5 rounded-xl bg-amber-50 p-4 text-amber-900"><p role="alert">{error}</p><button disabled={!!busy} onClick={() => { setError(""); setLoading(true); setAttempt(value => value + 1); }} className="mt-2 font-semibold underline">Try again</button></div>}
    {!loading && (!session || session.account.isTrial) && <p className="mt-5"><Link href="/" className="font-semibold text-primary-700 underline">Sign in with a registered account</Link> to manage AI connections.</p>}
    {session && !session.account.isTrial && <><CurrentListSelection key={session.account.id} accountId={session.account.id} />
      {resource && <label className="mt-6 block text-sm font-semibold">Your MCP address<input readOnly value={resource} onFocus={e => e.target.select()} className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal" /><span className="mt-2 block font-normal text-slate-600">Use this address to start a connection in a supported AI app. You will review its permissions before access is granted.</span></label>}
      {!loading && !error && !connections.length && <p className="mt-6">No AI apps are connected. Start a connection from a supported AI app using your MyShoppingList MCP address.</p>}
      <ul className="mt-6 space-y-4">{connections.map(c => <li key={c.id} className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold">{c.clientName}</h2>
        <p className="mt-1 text-sm text-slate-500">Connected {new Date(c.connectedAt).toLocaleDateString()} · {c.lastUsedAt ? `Last used ${new Date(c.lastUsedAt).toLocaleString()}` : "Not used yet"}</p>
        <ul className="mt-3 list-disc pl-5 text-sm text-slate-700">{c.scopes.filter(s => s !== "offline_access").map(s => <li key={s}>{scopeLabels[s] ?? s}</li>)}</ul>
        {c.revokedAt ? <p role="status" className="mt-4 font-semibold text-slate-500">Access revoked</p> : confirm === c.id ? <div className="mt-4"><p className="text-sm">Stop this app from accessing your account?</p><div className="mt-2 flex gap-4"><button disabled={!!busy} onClick={() => void revoke(c.id)} className="min-h-11 font-semibold text-red-700">{busy === c.id ? "Revoking…" : "Revoke access now"}</button><button disabled={!!busy} onClick={() => setConfirm(null)} className="min-h-11 font-semibold">Keep connected</button></div></div> : <button disabled={!!busy} onClick={() => setConfirm(c.id)} className="mt-4 min-h-11 font-semibold text-red-700">Revoke access</button>}
      </li>)}</ul><ExtensionDevices key={`devices-${session.account.id}`} /></>}
  </main></div>;
}
