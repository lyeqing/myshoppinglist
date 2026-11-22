"use client";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { Session } from "@/lib/api-types";
import Link from "next/link";
import SocialSignInButtons from "./social-sign-in-buttons";

export default function AccountForm({ mode, accountId, onSuccess, onBusy, onClose }: {
  mode: "register" | "login"; accountId?: number; onSuccess: (session: Session) => void;
  onBusy: (busy: boolean) => void; onClose: () => void;
}) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordId = useId();
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
    posting.current = true; setPending(true); onBusy(true); setError(""); setShowPassword(false);
    if (register) window.dispatchEvent(new Event("myshoppinglist-signup-started"));
    const request = new AbortController(); controller.current = request;
    try {
      const session = await api<Session>(`/auth/${mode}`, { method: "POST", signal: request.signal,
        body: JSON.stringify(register ? { email: email.trim(), password, displayName: name.trim() } : { email: email.trim(), password }) });
      if (!request.signal.aborted) { setPassword(""); setShowPassword(false); if (register) window.dispatchEvent(new Event("myshoppinglist-signup-completed")); onSuccess(session); }
    } catch (e) {
      if (!request.signal.aborted) {
        if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) { setPassword(""); setShowPassword(false); }
        setError(e instanceof Error ? e.message : "Please try again.");
        if (register && e instanceof ApiError && e.status === 401) setExpired(true);
      }
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
  return <section aria-labelledby="account-title" className="mb-7 rounded-2xl border border-primary-300 bg-white p-6 shadow-sm sm:p-8">
    <div className="flex items-start justify-between gap-4"><div><h2 id="account-title" className="text-xl font-semibold">{register ? "Create an account" : "Sign in"}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">{register ? "Create a free account to save your shopping lists and connect your AI app. No payment details needed." : "Welcome back. Sign in to open your saved shopping list."}</p></div>
      <button type="button" disabled={pending} onClick={onClose} className="text-sm font-semibold text-slate-600">Cancel</button></div>
    <div className="mt-5 max-w-md"><SocialSignInButtons key={accountId ?? "new"} accountId={accountId} disabled={pending || expired} /></div>
    <p className="mt-5 text-sm font-medium text-slate-600">Or continue with email and password</p>
    <form onSubmit={submit} className="mt-3 max-w-md space-y-4">
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
        {register && <div>
          <div className="flex items-center justify-between gap-3"><label htmlFor={`${passwordId}-display-name`} className="text-sm font-medium">Display name</label><span className="text-xs text-slate-500">Optional</span></div>
          <input id={`${passwordId}-display-name`} autoFocus className={input} maxLength={200} autoComplete="nickname" aria-describedby={`${passwordId}-display-name-help`} value={name} onChange={e => setName(e.target.value)} />
          <p id={`${passwordId}-display-name-help`} className="mt-2 text-xs text-slate-500">Leave blank to use your email address.</p>
        </div>}
        <label className="block text-sm font-medium">Email<input autoFocus={!register} className={input} type="email" required maxLength={320} autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <div>
          <label htmlFor={passwordId} className="block text-sm font-medium">Password</label>
          <div className="relative">
            <input id={passwordId} className={`${input} pr-20`} type={showPassword ? "text" : "password"} required minLength={register ? 8 : 1} maxLength={1024} autoComplete={register ? "new-password" : "current-password"} aria-describedby={register ? "password-help" : undefined} value={password} onChange={e => { setPassword(e.target.value); if (!e.target.value) setShowPassword(false); }} />
            <button type="button" disabled={pending} aria-controls={passwordId} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(value => !value)}
              className="absolute inset-y-0 right-0 mt-2 min-h-11 min-w-16 rounded-r-xl px-3 text-sm font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50">
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        {register && <p id="password-help" className="text-xs text-slate-500">Use at least 8 characters, including a number (0–9), a lowercase letter (a–z), an uppercase letter (A–Z), and a special character such as !, @ or #. Spaces do not count as special characters.</p>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-amber-800">{error}</p>}
      {expired && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>Your saved session is no longer valid. Clear it before creating a new account, or sign in to your existing account.</p><button type="button" disabled={pending} onClick={resetExpired} className="mt-2 font-semibold underline">Clear expired session for a new account</button></div>}
      <button disabled={pending || expired} className="rounded-xl bg-primary-700 hover:bg-primary-800 active:bg-primary-800 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Please wait…" : register ? "Create account" : "Sign in to my account"}</button>
      {!register && <Link href="/account/recovery" className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-primary-700 underline">Forgot password?</Link>}
    </form>
  </section>;
}
