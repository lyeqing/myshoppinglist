"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api-client";
import type { Session } from "@/lib/api-types";
import AppHeader from "./app-header";

export default function AccountSecurity() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [done, setDone] = useState(false);
  const [current, setCurrent] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const posting = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const load = () => {
      const version = ++generation.current; controller.current?.abort(); setSession(null); setCurrent(""); setPassword(""); setConfirmation("");
      setLoading(true); setPending(false); posting.current = false;
      const request = new AbortController(); controller.current = request;
      api<Session>("/auth/me", { signal: request.signal }).then(value => { if (!request.signal.aborted && generation.current === version) { setSession(value); setDone(false); } })
        .catch(e => { if (!request.signal.aborted) setError(e instanceof Error ? e.message : "Sign in to change your password."); })
        .finally(() => { if (!request.signal.aborted) setLoading(false); });
    };
    load(); window.addEventListener("myshoppinglist-session-changed", load);
    return () => { controller.current?.abort(); window.removeEventListener("myshoppinglist-session-changed", load); };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (posting.current || !session) return;
    if (password !== confirmation) { setError("The new passwords do not match."); return; }
    posting.current = true; setPending(true); setError("");
    const version = generation.current, request = new AbortController(); controller.current = request;
    try {
      await api<void>("/auth/password", { method: "POST", signal: request.signal,
        body: JSON.stringify({ expectedAccountId: session.account.id, currentPassword: current, newPassword: password }) });
      if (generation.current !== version || request.signal.aborted) return;
      setDone(true); setCurrent(""); setPassword(""); setConfirmation(""); setSession(null);
      window.dispatchEvent(new Event("myshoppinglist-session-changed"));
    } catch (e) {
      if (!request.signal.aborted && generation.current === version) {
        setError(e instanceof Error ? e.message : "Could not change your password.");
        if (e instanceof ApiError && (e.status === 401 || e.status === 409)) window.dispatchEvent(new Event("myshoppinglist-session-changed"));
      }
    }
    finally { if (generation.current === version) { posting.current = false; setPending(false); } }
  }
  const input = "mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3";
  return <div className="min-h-screen bg-slate-50"><AppHeader session={session} active="stores" loading={loading} disabled={pending} />
    <main className="mx-auto max-w-xl space-y-5 px-5 py-8"><h1 className="text-3xl font-semibold">Password and account security</h1>
      {done ? <div role="status" className="space-y-3 rounded-xl bg-emerald-50 p-5"><p>Your password was changed. You have been signed out on all devices. Connected AI apps and extensions were disconnected.</p><Link href="/" className="font-semibold underline">Sign in with your new password</Link></div>
        : loading ? <p role="status">Loading account…</p> : !session || session.account.isTrial ? <p>Sign in to a registered account to change your password. <Link href="/" className="underline">Return to sign in</Link></p>
        : <><p>Changing your password signs you out on all devices and disconnects AI apps and extensions. Your shopping lists are kept.</p>
          <form onSubmit={submit} className="space-y-4"><fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
            <label className="block">Current password<input required type="password" autoComplete="current-password" maxLength={1024} value={current} onChange={e => setCurrent(e.target.value)} className={input} /></label>
            <label className="block">New password<input required type="password" autoComplete="new-password" minLength={8} maxLength={1024} aria-describedby="security-password-help" value={password} onChange={e => setPassword(e.target.value)} className={input} /></label>
            <label className="block">Confirm new password<input required type="password" autoComplete="new-password" maxLength={1024} value={confirmation} onChange={e => setConfirmation(e.target.value)} className={input} /></label>
            <p id="security-password-help" className="text-sm text-slate-600">Use at least 8 characters with a number, a lowercase letter, an uppercase letter and a special character.</p>
          </fieldset><button disabled={pending} className="min-h-11 rounded-xl bg-primary-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{pending ? "Changing password…" : "Change password and sign out"}</button></form></>}
      {!done && error && <p role="alert" className="text-amber-800">{error}</p>}
      <p><Link href="/account/recovery" className="underline">Forgot your current password?</Link></p><p><Link href="/settings" className="underline">Back to settings</Link></p>
    </main></div>;
}
