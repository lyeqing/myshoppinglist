"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { AccountProfile as Profile } from "@/lib/api-types";

export default function AccountProfile({ accountId, disabled, onBusy, onSaved, onSignedOut }: {
  accountId: number; disabled: boolean; onBusy: (busy: boolean) => void;
  onSaved: (profile: Profile) => void; onSignedOut: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null), [attempt, setAttempt] = useState(0);
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [token, setToken] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null), posting = useRef(false), epoch = useRef(0);
  useEffect(() => {
    const readLink = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("email");
      if (value !== null) {
        ++epoch.current; request.current?.abort(); posting.current = false; setBusy(false); onBusy(false);
        setPassword(""); setError(""); setMessage(""); setToken(value.length <= 2048 ? value : "invalid");
        history.replaceState(history.state, "", window.location.pathname + window.location.search);
      }
    };
    readLink(); window.addEventListener("hashchange", readLink);
    return () => { request.current?.abort(); onBusy(false); window.removeEventListener("hashchange", readLink); };
  }, [accountId, onBusy]);
  useEffect(() => {
    const controller = new AbortController();
    api<Profile>("/account/profile", { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.accountId !== accountId) throw new Error("Your account changed. Reload Account settings.");
      setProfile(value); setName(value.displayName);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load your profile."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountId, attempt]);

  async function change(action: "name" | "request" | "complete" | "cancel") {
    if (posting.current || disabled || !profile) return;
    posting.current = true; setBusy(true); onBusy(true); setError(""); setMessage("");
    const version = epoch.current, controller = new AbortController(); request.current = controller;
    const fields = action === "name" ? { expectedUpdatedDate: profile.updatedDate, displayName: name.trim() }
      : action === "request" ? { expectedEmail: profile.email, email: email.trim(), currentPassword: profile.hasPassword ? password : null }
      : action === "cancel" ? { pendingEmailId: profile.pendingEmailId } : { token };
    try {
      const value = await api<Profile>(action === "name" ? "/account/profile" : `/account/email/${action}`, {
        method: action === "name" ? "PUT" : "POST", signal: controller.signal,
        body: JSON.stringify({ expectedAccountId: accountId, ...fields }),
      });
      if (version !== epoch.current || controller.signal.aborted) return;
      setPassword("");
      if (action === "complete") { setToken(""); onSignedOut(); return; }
      setProfile(value); onSaved(value);
      if (action === "name") { setName(value.displayName); setMessage("Display name saved."); }
      if (action === "request") { setEmail(""); setToken(""); setMessage("Verification requested. Check your new email inbox and spam folder. Your current email stays active until you confirm."); }
      if (action === "cancel") { setToken(""); setMessage("Email change cancelled. Your current email has not changed."); }
    } catch (e) {
      if (version !== epoch.current || controller.signal.aborted) return;
      setPassword(""); setError(e instanceof Error ? e.message : "Could not update your account.");
      if (e instanceof ApiError && e.status === 401) window.dispatchEvent(new Event("myshoppinglist-session-changed"));
    } finally {
      if (version === epoch.current) { posting.current = false; setBusy(false); onBusy(false); }
    }
  }
  const input = "mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3";
  const button = "min-h-11 rounded-xl bg-primary-700 px-4 py-3 font-semibold text-white disabled:opacity-50";
  const locked = disabled || busy;
  return <section aria-label="Profile and email" className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
    {loading ? <p role="status">Loading profile…</p> : profile && <>
      <form onSubmit={e => { e.preventDefault(); void change("name"); }} className="space-y-3">
        <h2 className="text-xl font-semibold">Display name</h2>
        <fieldset disabled={locked} className="space-y-3">
          <label className="block" htmlFor="profile-name">Display name <span className="text-sm text-slate-500">(optional)</span></label>
          <input id="profile-name" className={input} maxLength={200} autoComplete="nickname" aria-describedby="profile-name-help" value={name} onChange={e => setName(e.target.value)} />
          <p id="profile-name-help" className="text-sm text-slate-600">Leave blank to show your email address instead.</p>
          <button className={button} disabled={name.trim() === profile.displayName}>Save display name</button>
        </fieldset>
      </form>
      <div className="space-y-3 border-t border-slate-200 pt-5"><h2 className="text-xl font-semibold">Email address</h2>
        <p className="break-all">Current email: <strong>{profile.email ?? "No email address added"}</strong></p>
        {profile.pendingEmail && <div className="space-y-2 rounded-xl bg-amber-50 p-4">
          <p className="break-all">Pending verification: <strong>{profile.pendingEmail}</strong></p>
          <p className="text-sm">Open the link in this browser while signed in. It expires {new Date(profile.pendingEmailExpiresAt!).toLocaleString()}. Your current email stays active until confirmed.</p>
          <button type="button" disabled={locked} className="min-h-11 font-semibold underline" onClick={() => void change("cancel")}>Cancel email change</button>
        </div>}
        {token && (profile.pendingEmailId && token.startsWith(profile.pendingEmailId + ".") ? <div className="space-y-3 rounded-xl border border-amber-300 p-4">
          <p className="break-all">Confirm changing your email to <strong>{profile.pendingEmail}</strong>?</p>
          <p className="text-sm">This signs you out on all devices and disconnects AI apps and extensions. Your shopping lists are kept.</p>
          <button type="button" disabled={locked || !profile.emailChangeAvailable} className={button} onClick={() => void change("complete")}>Confirm new email and sign out</button>
          <button type="button" disabled={locked} className="ml-3 min-h-11 underline" onClick={() => setToken("")}>Dismiss verification link</button>
        </div> : <p role="alert" className="text-amber-800">This verification link is no longer current. Request a new link below.</p>)}
        {!profile.emailChangeAvailable ? <p>Email verification is unavailable. Your current email has not changed. Try again later.</p>
          : <form onSubmit={e => { e.preventDefault(); void change("request"); }} className="space-y-3">
            <p className="text-sm text-slate-600">Verify a new address before it replaces your current email. A successful change signs out all devices and disconnects AI apps and extensions.</p>
            <fieldset disabled={locked} className="space-y-3">
              <label className="block">New email address<input className={input} required type="email" autoComplete="email" maxLength={320} value={email} onChange={e => setEmail(e.target.value)} /></label>
              {profile.hasPassword ? <label className="block">Current password for email change<input className={input} required type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} /></label>
                : <p className="text-sm">First verify a connected provider in Sign-in methods below. Then return here to request your email change.</p>}
              <button className={button}>{profile.pendingEmail ? "Request another verification link" : "Send verification link"}</button>
              <p className="text-sm text-slate-500">Wait two minutes between requests. A new link replaces any earlier link.</p>
            </fieldset>
          </form>}
      </div>
    </>}
    {busy && <p role="status">Saving account settings…</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3">{message}</p>}
    {error && <div role="alert" className="space-y-2 text-amber-800"><p>{error}</p><button type="button" disabled={locked} className="min-h-11 underline" onClick={() => { setLoading(true); setError(""); setAttempt(value => value + 1); }}>Reload profile</button></div>}
  </section>;
}
