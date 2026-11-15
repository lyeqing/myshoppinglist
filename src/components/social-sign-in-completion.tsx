"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import type { Session } from "@/lib/api-types";

export default function SocialSignInCompletion() {
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState("");
  const [trialSwitch, setTrialSwitch] = useState(false),
    [verification, setVerification] = useState("");
  const [session, setSession] = useState<Session | null>(null),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const posting = useRef(false),
    initial = useRef<string | null>(null);
  const pendingRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    let identityRequest: AbortController | null = null;
    const loadLink = (value: string) => {
      initial.current = value.length <= 2048 ? value : "";
      if (window.location.hash)
        history.replaceState(history.state, "", window.location.pathname);
      identityRequest?.abort();
      pendingRequest.current?.abort();
      posting.current = false;
      setBusy(false);
      setDone("");
      setSession(null);
      setPassword("");
      setConfirmation("");
      setTrialSwitch(false);
      setVerification(initial.current);
      setError("");
      const failure = new URLSearchParams(window.location.search).get("error");
      if (failure && !initial.current)
        setError(
          failure === "cancelled"
            ? "You cancelled provider sign-in. Your account and lists have not changed."
            : "The provider sign-in could not be completed. It may have expired or the provider may be unavailable. Start again.",
        );
      if (initial.current) {
        const controller = new AbortController();
        identityRequest = controller;
        api<Session>("/auth/me", { signal: controller.signal })
          .then((value) => {
            if (!controller.signal.aborted) setSession(value);
          })
          .catch(() => {
            if (!controller.signal.aborted)
              setError(
                "Open this verification link in the browser where you requested it, while still signed in.",
              );
          });
      }
      setReady(true);
    };
    loadLink(
      initial.current ??
        new URLSearchParams(window.location.hash.slice(1)).get("verify") ??
        "",
    );
    const hashChanged = () => {
      if (window.location.hash.startsWith("#verify="))
        loadLink(
          new URLSearchParams(window.location.hash.slice(1)).get("verify") ??
            "",
        );
    };
    const changed = () => {
      identityRequest?.abort();
      pendingRequest.current?.abort();
      posting.current = false;
      initial.current = "";
      setVerification("");
      setBusy(false);
      setSession(null);
      setPassword("");
      setConfirmation("");
      setError(
        "Your account changed. Return to account security and start again.",
      );
    };
    window.addEventListener("myshoppinglist-session-changed", changed);
    window.addEventListener("hashchange", hashChanged);
    return () => {
      identityRequest?.abort();
      pendingRequest.current?.abort();
      window.removeEventListener("myshoppinglist-session-changed", changed);
      window.removeEventListener("hashchange", hashChanged);
    };
  }, []);
  async function finish(leaveTrialSeparate = false) {
    if (posting.current) return;
    posting.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    pendingRequest.current = controller;
    try {
      const result = await api<{ outcome: string }>("/auth/social/complete", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ leaveTrialSeparate }),
      });
      if (controller.signal.aborted) return;
      if (result.outcome === "confirm_trial_switch") {
        setTrialSwitch(true);
        return;
      }
      setDone(
        result.outcome === "connected"
          ? "Provider connected to your existing account."
          : result.outcome === "verified"
            ? "Identity verified. Return to account security to manage sign-in methods."
            : result.outcome === "trial_saved"
              ? "Your trial is now a permanent account. Your lists and preferences are kept."
              : "You are signed in to MyShoppingList.",
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Could not finish sign-in. Start again.",
        );
    } finally {
      if (!controller.signal.aborted) {
        posting.current = false;
        setBusy(false);
      }
    }
  }
  async function addPassword(event: React.FormEvent) {
    event.preventDefault();
    if (posting.current || !session) return;
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    posting.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    pendingRequest.current = controller;
    try {
      await api("/auth/social/password/complete", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          expectedAccountId: session.account.id,
          token: verification,
          newPassword: password,
        }),
      });
      if (controller.signal.aborted) return;
      setDone(
        "Your email/password sign-in is ready. You have been signed out on all devices. Sign in using your new password or a connected provider.",
      );
      setPassword("");
      setConfirmation("");
      setVerification("");
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Could not add your password.",
        );
    } finally {
      if (!controller.signal.aborted) {
        posting.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <main className="mx-auto max-w-xl space-y-5 px-5 py-10">
      <h1 className="text-3xl font-semibold">Finish signing in</h1>
      {!ready ? (
        <p role="status">Preparing sign-in…</p>
      ) : done ? (
        <p role="status" className="rounded-xl bg-emerald-50 p-5">
          {done}
        </p>
      ) : verification ? (
        <>
          <p>
            Verify your email and choose a password for your existing account.
            Connected providers remain available.
          </p>
          {session && (
            <form onSubmit={addPassword} className="space-y-4">
              <label className="block">
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={1024}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 block w-full rounded-xl border px-3 py-3"
                />
              </label>
              <label className="block">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={1024}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className="mt-2 block w-full rounded-xl border px-3 py-3"
                />
              </label>
              <p className="text-sm text-slate-600">
                Use at least 8 characters with a number, lowercase letter,
                uppercase letter and special character.
              </p>
              <button
                disabled={busy}
                className="min-h-11 rounded-xl bg-primary-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                Verify email and add password
              </button>
            </form>
          )}
        </>
      ) : (
        !error && (
          <>
            {trialSwitch ? (
              <p className="rounded-xl bg-amber-50 p-4">
                This provider opens an existing account. Continuing leaves your
                temporary trial separate; its lists and preferences will not be
                merged. You can return to the trial instead.
              </p>
            ) : (
              <p>
                Your provider sign-in is ready. Continue to open your account or
                save your active trial. Existing accounts are never merged
                automatically.
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void finish(trialSwitch)}
              className="min-h-11 rounded-xl bg-primary-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy
                ? "Completing sign-in…"
                : trialSwitch
                  ? "Open existing account; leave trial separate"
                  : "Continue to MyShoppingList"}
            </button>
          </>
        )
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">
          {error}
        </p>
      )}
      <p>
        <Link href="/account/security" className="underline">
          Account security and sign-in methods
        </Link>
      </p>
      <p>
        <Link href="/" className="underline">
          {trialSwitch && !done ? "Return to my trial" : "Open MyShoppingList"}
        </Link>
      </p>
    </main>
  );
}
