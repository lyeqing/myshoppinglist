"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api-client";
import type { Session } from "@/lib/api-types";
import MainNavigation from "./main-navigation";

type Props = {
  session: Session | null;
  active: "lists" | "in-store" | "stores" | "products" | "archives";
  loading?: boolean;
  disabled?: boolean;
  onSignOut?: () => Promise<void>;
  onSignIn?: () => void;
  showSignIn?: boolean;
};

const button = "inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-700 disabled:opacity-50";

export default function AppHeader({ session, active, loading = false, disabled = false, onSignOut, onSignIn, showSignIn = true }: Props) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const name = session?.account.displayName.trim() || "Shopper";
  const parts = name.split(/\s+/u);
  const initials = [parts[0], ...(parts.length > 1 ? [parts[parts.length - 1]] : [])]
    .map((part) => Array.from(part)[0]).join("").toLocaleUpperCase();

  async function signOut() {
    if (pending.current || disabled) return;
    pending.current = true;
    setSigningOut(true);
    setError("");
    try {
      if (onSignOut) {
        await onSignOut();
      } else {
        try {
          await api<void>("/auth/logout", { method: "POST" });
        } catch (cause) {
          if (!(cause instanceof ApiError && cause.status === 401)) throw cause;
        }
        window.dispatchEvent(new Event("myshoppinglist-session-changed"));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out. Please try again.");
    } finally {
      pending.current = false;
      setSigningOut(false);
    }
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-5 py-4 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Link href="/" className="shrink-0 text-sm font-semibold text-sky-800 sm:text-base">MyShoppingList</Link>
          <div className="flex max-w-full flex-wrap items-center justify-end gap-3">
            {session && (
              <>
                <div role="group" aria-label={session.account.isTrial ? "Trial session" : `Signed in as ${name}`} title={session.account.isTrial ? "Trial session" : name} className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-800 sm:flex">{session.account.isTrial ? "T" : initials}</span>
                  <span className="max-w-32 truncate text-sm font-medium text-slate-700 sm:max-w-56">{session.account.isTrial ? "Trial session" : name}</span>
                </div>
                <button type="button" className={button} disabled={disabled || signingOut} onClick={() => void signOut()}>
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </>
            )}
            {showSignIn && (!session || session.account.isTrial) && !loading && (
              onSignIn
                ? <button type="button" className={button} disabled={disabled || signingOut} onClick={onSignIn}>Sign in</button>
                : <Link href="/" className={button}>Sign in</Link>
            )}
            {!session && loading && <span role="status" className="text-sm text-slate-500">Loading account…</span>}
          </div>
        </div>
        <MainNavigation session={session} active={active} className="mt-3" />
        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error} Try signing out again.</p>}
      </div>
    </header>
  );
}
