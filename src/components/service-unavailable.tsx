"use client";

import { useEffect, useRef } from "react";

export default function ServiceUnavailable({ retry, busy, error }: { retry: () => void; busy: boolean; error: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <main id="main" className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-5 py-16">
    <p className="text-sm font-semibold text-primary-700">MyShoppingList</p>
    <section aria-labelledby="unavailable-title" className="mt-6 rounded-2xl border border-amber-200 bg-white p-6 sm:p-10">
      <h1 ref={heading} tabIndex={-1} id="unavailable-title" className="text-3xl font-semibold">Temporarily unavailable</h1>
      <p className="mt-4 text-slate-600">We can’t connect to the account service. Please try again later.</p>
      <p className="mt-3 text-sm text-slate-600">We can’t confirm your sign-in status right now. Signing in and creating an account may be unavailable.</p>
      <p role="alert" className="mt-4 text-sm text-amber-900">{error}</p>
      <button type="button" disabled={busy} onClick={retry} className="mt-6 min-h-11 rounded-xl bg-primary-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Checking availability…" : "Try again"}</button>
      <p role="status" className="mt-3 text-sm text-slate-500">{busy ? "Checking the account service. Your previous action will not be submitted again." : "Retry checks availability without submitting your previous action again."}</p>
    </section>
  </main>;
}
