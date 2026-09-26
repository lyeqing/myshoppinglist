"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { Session } from "@/lib/api-types";

export default function AccountForm({ mode, trial, onSuccess, onBusy, onClose }: {
  mode: "register" | "login"; trial: boolean; onSuccess: (session: Session) => void;
  onBusy: (busy: boolean) => void; onClose: () => void;
}) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [name, setName] = useState(""); const [error, setError] = useState("");
  const [pending, setPending] = useState(false); const [expired, setExpired] = useState(false);
  const controller = useRef<AbortController | null>(null); const posting = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  const register = mode === "register";
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (posting.current) return;
    if (register && (password.length < 8 || !/[0-9]/.test(password) || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[\p{P}\p{S}]/u.test(password))) {
      setError("Use at least 8 characters with a number (0–9), a lowercase letter (a–z), an uppercase letter (A–Z), and a special character. Spaces do not count as special characters."); return;
    }
    posting.current = true; setPending(true); onBusy(true); setError("");
    const request = new AbortController(); controller.current = request;
    try {
      const session = await api<Session>(`/auth/${mode}`, { method: "POST", signal: request.signal,
        body: JSON.stringify(register ? { email: email.trim(), password, displayName: name.trim() } : { email: email.trim(), password }) });
      if (!request.signal.aborted) { setPassword(""); onSuccess(session); }
    } catch (e) {
      if (!request.signal.aborted) { setError(e instanceof Error ? e.message : "Please try again."); if (register && e instanceof ApiError && e.status === 401) setExpired(true); }
    } finally { posting.current = false; if (!request.signal.aborted) { setPending(false); onBusy(false); } }
  }
  async function resetExpired() {
    if (posting.current) return;
    posting.current = true; setPending(true); onBusy(true); setError("");
    const request = new AbortController(); controller.current = request;
    try { await api<void>("/auth/reset-expired", { method: "POST", signal: request.signal });
      if (!request.signal.aborted) { setExpired(false); setError("Expired session cleared. Submit again to create a new account with an empty list."); }
    } catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : "Please try again."); }
    finally { posting.current = false; if (!request.signal.aborted) { setPending(false); onBusy(false); } }
  }
  const input = "mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm";
  return <section aria-labelledby="account-title" className="mb-7 rounded-2xl border border-sky-200 bg-white p-6 shadow-sm sm:p-8">
    <div className="flex items-start justify-between gap-4"><div><h2 id="account-title" className="text-xl font-semibold">{register ? trial ? "Keep my list" : "Create an account" : "Sign in"}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">{register ? trial ? "Create an account before your trial ends to keep your list and saved edits." : "Create your account and start a permanent shopping list." : trial ? "Sign in to open your existing account. This trial list will not be merged, and unsaved edits will be discarded." : "Welcome back. Sign in to open your saved shopping list."}</p></div>
      <button type="button" disabled={pending} onClick={onClose} className="text-sm font-semibold text-slate-600">Cancel</button></div>
    <form onSubmit={submit} className="mt-5 max-w-md space-y-4">
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
        {register && <label className="block text-sm font-medium">Display name<input autoFocus className={input} required maxLength={200} autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} /></label>}
        <label className="block text-sm font-medium">Email<input autoFocus={!register} className={input} type="email" required maxLength={320} autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="block text-sm font-medium">Password<input className={input} type="password" required minLength={register ? 8 : 1} maxLength={1024} autoComplete={register ? "new-password" : "current-password"} aria-describedby={register ? "password-help" : undefined} value={password} onChange={e => setPassword(e.target.value)} /></label>
        {register && <p id="password-help" className="text-xs text-slate-500">Use at least 8 characters, including a number (0–9), a lowercase letter (a–z), an uppercase letter (A–Z), and a special character such as !, @ or #. Spaces do not count as special characters.</p>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-amber-800">{error}</p>}
      {expired && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>An expired trial cannot be recovered. You can explicitly clear its session and create a new, empty list.</p><button type="button" disabled={pending} onClick={resetExpired} className="mt-2 font-semibold underline">Clear expired session for a new account</button></div>}
      <button disabled={pending || expired} className="rounded-xl bg-sky-700 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50">{pending ? "Please wait…" : register ? "Create account" : "Sign in to my account"}</button>
    </form>
  </section>;
}
