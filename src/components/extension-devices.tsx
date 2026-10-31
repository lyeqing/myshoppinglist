"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
type Device = { id: string; extensionVersion: string; linkedAt: string; lastSeenAt: string | null; revokedAt: string | null; sessionActive: boolean };
export default function ExtensionDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    api<Device[]>("/account/extension-devices", { signal: abort.signal }).then(value => {
      setEnabled(true); setDevices(value); setError("");
    }).catch(e => { if (!abort.signal.aborted && !(e instanceof ApiError && e.status === 404)) {
      setEnabled(true); setError(e instanceof Error ? e.message : "Unable to load linked browsers.");
    } });
    return () => abort.abort();
  }, [attempt]);
  async function revoke(id: string) {
    setBusy(id); setError("");
    try { await api<void>(`/account/extension-devices/${id}`, { method: "DELETE" });
      setDevices(value => value.map(d => d.id === id ? { ...d, revokedAt: new Date().toISOString() } : d)); setConfirm(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to unlink this browser."); }
    finally { setBusy(null); }
  }
  if (!enabled) return null;
  return <section className="mt-8 border-t border-slate-200 pt-6" aria-labelledby="linked-browsers-title">
    <h2 id="linked-browsers-title" className="text-xl font-semibold">Linked extension browsers</h2>
    <p className="mt-2 text-slate-600">Link a browser from Open AI requests in the MyShoppingList extension. Each capture or search needs your approval there. Last seen indicates recent contact, not a guarantee that Chrome is available.</p>
    {error && <div className="mt-3"><p role="alert">{error}</p><button disabled={!!busy} onClick={() => setAttempt(v => v + 1)} className="min-h-11 font-semibold underline">Retry loading browsers</button></div>}
    {!error && !devices.length && <p className="mt-3">No extension browsers are linked.</p>}
    <ul className="mt-4 space-y-3">{devices.map(d => <li key={d.id} className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">MyShoppingList extension {d.extensionVersion}</h3>
      <p className="mt-1 text-sm text-slate-600">Linked {new Date(d.linkedAt).toLocaleString()} · {d.lastSeenAt ? `Last seen ${new Date(d.lastSeenAt).toLocaleString()}` : "Not seen yet"}</p>
      {d.revokedAt ? <p role="status" className="mt-2">Browser unlinked</p> : !d.sessionActive ? <p className="mt-2">The sign-in session has ended. Sign in and link again in this browser.</p> : confirm === d.id ? <div className="mt-2"><p>Unlink this browser and stop its pending requests?</p><button disabled={!!busy} onClick={() => void revoke(d.id)} className="mr-5 min-h-11 font-semibold text-red-700">{busy === d.id ? "Unlinking…" : "Unlink browser now"}</button><button disabled={!!busy} onClick={() => setConfirm(null)} className="min-h-11 font-semibold">Keep linked</button></div> : <button disabled={!!busy} onClick={() => setConfirm(d.id)} className="mt-2 min-h-11 font-semibold text-red-700">Unlink browser</button>}
    </li>)}</ul>
  </section>;
}
