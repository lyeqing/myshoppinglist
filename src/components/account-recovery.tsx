"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";

export default function AccountRecovery() {
  const [ready, setReady] = useState(false), [enabled, setEnabled] = useState(false), [pending, setPending] = useState(false);
  const [token, setToken] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(""), [sent, setSent] = useState(false), [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0); const initialToken = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null), posting = useRef(false);
  useEffect(() => {
    if (initialToken.current === null) {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
      initialToken.current = value && value.length <= 2048 ? value : "";
    }
    // Fragments never reach HTTP logs/referrers. Remove the capability from history immediately.
    if (window.location.hash) history.replaceState(history.state, "", window.location.pathname);
    const changedLink = () => {
      if (!window.location.hash.startsWith("#token=")) return;
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
      initialToken.current = value && value.length <= 2048 ? value : "";
      history.replaceState(history.state, "", window.location.pathname);
      if (posting.current) controller.current?.abort();
      posting.current = false; setPending(false); setToken(initialToken.current);
      setSent(false); setDone(false); setPassword(""); setConfirmation(""); setError("");
    };
    window.addEventListener("hashchange", changedLink);
    const request = new AbortController(); controller.current = request;
    api<{ enabled: boolean }>("/auth/recovery", { signal: request.signal }).then(result => { if (!request.signal.aborted) { setEnabled(result.enabled); setToken(initialToken.current ?? ""); } })
      .catch(e => { if (!request.signal.aborted) setError(e instanceof Error ? e.message : "Could not check recovery availability."); })
      .finally(() => { if (!request.signal.aborted) setReady(true); });
    return () => { controller.current?.abort(); window.removeEventListener("hashchange", changedLink); };
  }, [attempt]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (posting.current) return;
    if (token && password !== confirmation) { setError("The new passwords do not match."); return; }
    posting.current = true; setPending(true); setError("");
    const request = new AbortController(); controller.current = request;
    try {
      await api<void>(token ? "/auth/recovery/complete" : "/auth/recovery/request", { method: "POST", signal: request.signal,
        body: JSON.stringify(token ? { token, newPassword: password } : { email: email.trim() }) });
      if (request.signal.aborted) return;
      if (token) { setDone(true); setPassword(""); setConfirmation(""); setToken(""); initialToken.current = ""; window.dispatchEvent(new Event("myshoppinglist-session-changed")); }
      else setSent(true);
    } catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : "Could not complete recovery."); }
    finally { posting.current = false; if (!request.signal.aborted) setPending(false); }
  }
  const input = "mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3";
  return <main className="mx-auto max-w-xl space-y-5 px-5 py-10"><Link href="/" className="font-semibold text-primary-700">MyShoppingList</Link>
    <h1 className="text-3xl font-semibold">{token ? "Choose a new password" : "Recover your account"}</h1>
    {!ready ? <p role="status">Checking recovery availability…</p> : done ? <div role="status" className="space-y-3 rounded-xl bg-emerald-50 p-5"><p>Your password was updated. Existing sessions and AI/extension connections were disconnected.</p><Link href="/" className="font-semibold underline">Sign in with your new password</Link></div>
      : !enabled ? <p>Password recovery is not available yet. <Link href="/support" className="underline">Contact support for help</Link>. Your password has not changed.</p>
      : sent ? <div role="status" className="space-y-3 rounded-xl bg-emerald-50 p-5"><p>If an active account uses that email, you will receive a reset link. Check your inbox and spam folder. Allow a few minutes for delivery.</p><p>Repeated requests within ten minutes are grouped to protect your inbox.</p><button className="min-h-11 font-semibold underline" onClick={() => { setSent(false); setEmail(""); }}>Use a different email</button></div>
      : <form onSubmit={submit} className="space-y-4"><p>{token ? "This link expires within 15 minutes and can be used once. Your shopping lists will be kept." : "Enter your account email to request a reset link. Your password stays unchanged until you use the link."}</p>
        <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">{!token ? <label className="block">Account email<input autoFocus required type="email" autoComplete="email" maxLength={320} value={email} onChange={e => setEmail(e.target.value)} className={input} /></label>
          : <><label className="block">New password<input autoFocus required type="password" autoComplete="new-password" minLength={8} maxLength={1024} aria-describedby="recovery-password-help" value={password} onChange={e => setPassword(e.target.value)} className={input} /></label>
            <label className="block">Confirm new password<input required type="password" autoComplete="new-password" maxLength={1024} value={confirmation} onChange={e => setConfirmation(e.target.value)} className={input} /></label>
            <p id="recovery-password-help" className="text-sm text-slate-600">Use at least 8 characters with a number, a lowercase letter, an uppercase letter and a special character.</p></>}
        </fieldset><button disabled={pending} className="min-h-11 rounded-xl bg-primary-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{pending ? "Please wait…" : token ? "Reset password" : "Send reset link"}</button>
        {token && <button type="button" disabled={pending} className="ml-4 min-h-11 underline" onClick={() => { initialToken.current = ""; setToken(""); setPassword(""); setConfirmation(""); setError(""); }}>Request a new link</button>}</form>}
    {error && !done && <p role="alert" className="break-words text-amber-800">{error}</p>}
    {ready && !enabled && error && <button className="min-h-11 underline" onClick={() => { setReady(false); setError(""); setAttempt(n => n + 1); }}>Retry availability check</button>}
    <p><Link href="/" className="underline">Back to MyShoppingList</Link></p>
  </main>;
}
