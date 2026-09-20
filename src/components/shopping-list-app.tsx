"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api-client";
import { isActive, placeholder, type Accepted, type ImportPage, type Job, type Session } from "@/lib/api-types";
import ImportCard, { Spinner } from "./import-card";
import ShoppingListItems from "./shopping-list-items";

const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-sky-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";
const message = (e: unknown) => e instanceof Error ? e.message : "Something went wrong. Please try again.";
const aborted = (e: unknown) => e instanceof Error && e.name === "AbortError";

export default function ShoppingListApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<Record<number, Job>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [url, setUrl] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  const posting = useRef(false);
  const generation = useRef(0);

  const endSession = useCallback((text: string) => {
    generation.current++; setSession(null); setJobs({}); setErrors({}); setCursor(null); setNotice(text); setLoadError(""); setFormError(""); setUrl(""); setQuantity("1");
  }, []);
  const handleError = useCallback((error: unknown, display: (text: string) => void) => {
    if (aborted(error)) return;
    if (error instanceof ApiError && error.status === 401) endSession(error.message);
    else display(message(error));
  }, [endSession]);
  const loadPage = useCallback(async (listId: number, before: number | null, signal: AbortSignal) => {
    const version = generation.current;
    setLoading(true); setLoadError("");
    try {
      const page = await api<ImportPage>(`/shopping-lists/${listId}/imports?pageSize=20${before ? `&beforeId=${before}` : ""}`, { signal });
      if (signal.aborted || version !== generation.current) return;
      setCursor(page.nextBeforeId);
      const results = await Promise.allSettled(page.items.map(item => api<Job>(`/product-import-jobs/${item.jobId}`, { signal })));
      if (signal.aborted || version !== generation.current) return;
      const authFailure = results.find(result => result.status === "rejected" && result.reason instanceof ApiError && result.reason.status === 401);
      if (authFailure?.status === "rejected") { handleError(authFailure.reason, setLoadError); return; }
      const restored: Record<number, Job> = {}; const failures: Record<number, string> = {};
      results.forEach((result, index) => { const item = page.items[index];
        if (result.status === "fulfilled") restored[item.jobId] = result.value;
        else { restored[item.jobId] = { ...placeholder(item.jobId, listId), status: item.status, createdDate: item.createdDate }; failures[item.jobId] = message(result.reason); }
      });
      setJobs(previous => ({ ...previous, ...restored })); setErrors(previous => ({ ...previous, ...failures }));
    } catch (error) { if (version === generation.current) handleError(error, setLoadError); }
    finally { if (!signal.aborted && version === generation.current) setLoading(false); }
  }, [handleError]);

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    async function restore() {
      try { const current = await api<Session>("/auth/me", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setSession(current); if (current.shoppingListId) await loadPage(current.shoppingListId, null, controller.signal);
      } catch (error) { if (!aborted(error) && !(error instanceof ApiError && error.status === 401)) setNotice(message(error)); }
      finally { if (!controller.signal.aborted) setBooting(false); }
    }
    void restore(); return () => controller.abort();
  }, [loadPage]);

  useEffect(() => {
    if (!session) return;
    const delay = Math.max(0, new Date(session.sessionExpiresDate).getTime() - Date.now());
    const timer = setTimeout(() => endSession("Your trial has ended. Start a new trial to continue."), Math.min(delay, 2147483647));
    return () => clearTimeout(timer);
  }, [session, endSession]);

  const activeIds = Object.values(jobs).filter(job => isActive(job) && !errors[job.jobId]).map(job => job.jobId).sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (!session || !activeIds) return;
    const controller = new AbortController(); const version = generation.current;
    let timer: ReturnType<typeof setTimeout>;
    const ids = activeIds.split(",").map(Number);
    async function poll() {
      const results = await Promise.allSettled(ids.map(id => api<Job>(`/product-import-jobs/${id}`, { signal: controller.signal })));
      if (controller.signal.aborted || version !== generation.current) return;
      if (results.some(result => result.status === "rejected" && result.reason instanceof ApiError && result.reason.status === 401)) {
        endSession("Your trial has ended. Start a new trial to continue."); return;
      }
      const updates: Record<number, Job> = {}; const failures: Record<number, string> = {};
      results.forEach((result, index) => { if (result.status === "fulfilled") updates[ids[index]] = result.value; else failures[ids[index]] = message(result.reason); });
      setJobs(previous => ({ ...previous, ...updates })); setErrors(previous => ({ ...previous, ...failures }));
      timer = setTimeout(poll, 2000);
    }
    timer = setTimeout(poll, 2000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activeIds, session, endSession]);

  async function startTrial() {
    setBusy(true); setNotice("");
    try { const current = await api<Session>("/auth/trial", { method: "POST", signal: lifetime.current?.signal });
      if (lifetime.current?.signal.aborted) return;
      generation.current++; setSession(current); setJobs({}); setErrors({});
      if (current.shoppingListId) await loadPage(current.shoppingListId, null, lifetime.current!.signal);
    } catch (error) { handleError(error, setNotice); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await api<void>("/auth/logout", { method: "POST", signal: lifetime.current?.signal }); endSession("You’ve signed out of this trial."); }
    catch (error) { handleError(error, setNotice); } finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (posting.current || !session?.shoppingListId) return;
    const qty = Number(quantity);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 2147483647) { setFormError("Enter a positive whole-number quantity."); return; }
    const version = generation.current;
    posting.current = true; setSubmitting(true); setFormError("");
    try {
      const accepted = await api<Accepted>(`/shopping-lists/${session.shoppingListId}/products/url`, { method: "POST", body: JSON.stringify({ url: url.trim(), quantity: qty }), signal: lifetime.current?.signal });
      if (version !== generation.current || lifetime.current?.signal.aborted) return;
      setJobs(previous => ({ ...previous, [accepted.jobId]: previous[accepted.jobId] ?? { ...placeholder(accepted.jobId, session.shoppingListId!, accepted.quantity), status: accepted.status } }));
      setUrl(""); setQuantity("1"); setNotice(accepted.reused ? "This product is already being checked. Its original requested quantity is unchanged." : "Link added. Keep shopping while we find your product.");
    } catch (error) { if (version === generation.current) handleError(error, setFormError); }
    finally { posting.current = false; setSubmitting(false); }
  }
  async function retry(id: number) {
    const version = generation.current;
    try { const job = await api<Job>(`/product-import-jobs/${id}`, { signal: lifetime.current?.signal });
      if (version !== generation.current) return;
      setJobs(previous => ({ ...previous, [id]: job })); setErrors(previous => { const next = { ...previous }; delete next[id]; return next; });
    } catch (error) { if (version === generation.current) handleError(error, text => setErrors(previous => ({ ...previous, [id]: text }))); }
  }
  const ordered = Object.values(jobs).sort((a, b) => b.jobId - a.jobId);
  const working = ordered.filter(isActive).length;
  return <>
    <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3">Skip to content</a>
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight"><span className="flex size-10 items-center justify-center rounded-xl bg-sky-700 text-white" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 8h16l-2 12H6L4 8ZM8 8l4-6 4 6M9 11v5m6-5v5" /></svg></span><span>MyShoppingList<span className="ml-2 hidden text-xs font-normal text-slate-400 sm:inline">EARLY ACCESS</span></span></Link>
        {session ? <button onClick={logout} disabled={busy} className="text-sm font-medium text-slate-500 hover:text-slate-900">Sign out</button> : <span className="text-xs text-slate-500">Made for everyday shopping</span>}
      </div>
    </header>
    <main id="main" className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
      <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
        <div><p className="mb-3 text-xs font-semibold tracking-widest text-sky-700">LESS GUESSWORK. BETTER SHOPPING.</p><h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Your list. <span className="text-sky-700">A clearer price.</span></h1><p className="mt-4 max-w-xl text-base leading-7 text-slate-500">Save a product link. We’ll find the details and keep the observed price with your shopping list.</p></div>
        {session && <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><span className="font-semibold">Your trial is active</span><p className="mt-1 text-xs">Expires {new Date(session.sessionExpiresDate).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })} · No account needed</p></div>}
      </div>
      {notice && <p role="status" className="mb-6 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">{notice}</p>}
      {booting ? <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-slate-500" role="status"><Spinner /> Restoring your shopping list…</div> : !session ?
        <section className="grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm md:grid-cols-2">
          <div className="p-7 sm:p-10"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">FREE 3-HOUR TRIAL</span><h2 className="mt-6 text-3xl font-semibold tracking-tight">A small step before<br />your next shop.</h2><p className="mt-4 max-w-md leading-7 text-slate-500">Try a temporary shopping list. No email, password, or payment details. Your list expires after three hours.</p><button onClick={startTrial} disabled={busy} className={`${primary} mt-7`}>{busy && <Spinner />}{busy ? "Starting your trial…" : "Start my shopping list"}<span aria-hidden="true">→</span></button><p className="mt-4 text-xs text-slate-400">Coles and Woolworths product links supported today.</p></div>
          <div className="border-t border-slate-100 bg-sky-50/60 p-7 sm:p-10 md:border-l md:border-t-0"><p className="text-xs font-semibold tracking-widest text-slate-500">THREE SIMPLE STEPS</p><ol className="mt-7 space-y-7">{[["Paste a product link", "Copy the product page URL from Coles or Woolworths."], ["Keep adding to your list", "We’ll find the details in the background."], ["See what we found", "Check the price, source, and observation time."]].map(([title, detail], i) => <li key={title} className="flex gap-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-white text-sm font-semibold text-sky-700">{i + 1}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-500">{detail}</p></div></li>)}</ol></div>
        </section> : <div className="grid items-start gap-7 lg:grid-cols-[340px_1fr]">
          <aside className="space-y-5 lg:sticky lg:top-6">
            <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Add to your list</h2><p className="mt-1 text-sm leading-6 text-slate-500">One product link at a time. Multiple imports can run together.</p>
              <label htmlFor="product-url" className="mb-2 mt-6 block text-sm font-medium">Product URL</label><input id="product-url" type="url" required disabled={submitting} maxLength={2048} placeholder="https://www.coles.com.au/product/…" value={url} onChange={e => setUrl(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm placeholder:text-slate-400 disabled:opacity-60" aria-describedby="url-help" />
              <p id="url-help" className="mt-2 text-xs leading-5 text-slate-400">Use the full product page link, not a search page.</p>
              <label htmlFor="quantity" className="mb-2 mt-5 block text-sm font-medium">Quantity</label><input id="quantity" type="number" required disabled={submitting} min={1} max={2147483647} step={1} inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-24 rounded-xl border border-slate-300 px-3 py-2.5 text-sm disabled:opacity-60" />
              {formError && <p role="alert" className="mt-4 text-sm leading-6 text-amber-800">{formError}</p>}
              <button disabled={submitting || !session.shoppingListId} className={`${primary} mt-6 w-full`}>{submitting ? <><Spinner /> Adding link…</> : <><span aria-hidden="true">+</span> Add product</>}</button>
              {!session.shoppingListId && <p className="mt-3 text-sm text-amber-800">This trial’s shopping list is no longer available.</p>}
            </form>
            <div className="rounded-2xl border border-slate-200 p-5"><h3 className="text-sm font-semibold">A note on prices</h3><p className="mt-2 text-sm leading-6 text-slate-500">These are observed page prices. Your store’s price and availability may differ. We’ll always show what we could verify.</p></div>
          </aside>
          <div>{session.shoppingListId && <ShoppingListItems key={session.shoppingListId} listId={session.shoppingListId} refreshKey={ordered.filter(j => j.shoppingListProductId).map(j => `${j.jobId}:${j.shoppingListProductId}:${isActive(j)}`).join(",")} onExpired={endSession} />}<section aria-labelledby="list-title"><div className="mb-5 flex flex-wrap items-center justify-between gap-2"><div><h2 id="list-title" className="text-xl font-semibold tracking-tight">Import history and price comparisons</h2><p className="mt-1 text-sm text-slate-500">{ordered.length} loaded import{ordered.length === 1 ? "" : "s"}{working ? ` · ${working} in progress` : ""}</p></div>{working > 0 && <span className="rounded-full bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-800">{activeIds ? "Updating every 2 seconds" : "Updates paused"}</span>}</div>
            {loadError && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{loadError} <button className="font-semibold underline" onClick={() => void loadPage(session.shoppingListId!, cursor, lifetime.current!.signal)}>Retry loading</button></p>}
            <div className="space-y-5">{ordered.map(job => <ImportCard key={job.jobId} job={job} error={errors[job.jobId]} onRetry={() => void retry(job.jobId)} />)}</div>
            {loading && <p role="status" className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading saved imports…</p>}
            {!loading && !ordered.length && !loadError && <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center"><span aria-hidden="true" className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-sky-50 text-3xl text-sky-600">＋</span><h3 className="text-lg font-semibold">Your next shop starts here</h3><p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">Paste your first Coles or Woolworths product link. The details will appear here when we find them.</p></div>}
            {cursor && <button disabled={loading} onClick={() => void loadPage(session.shoppingListId!, cursor, lifetime.current!.signal)} className={`${secondary} mt-5`}>Load older imports</button>}
          </section></div>
        </div>}
      <section className="mt-10 border-t border-slate-200 pt-6" aria-label="Retailer support"><div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm"><span className="text-xs font-semibold tracking-widest text-slate-400">RETAILER SUPPORT</span><span className="font-semibold text-slate-700">Coles · Woolworths <span className="ml-1 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Live</span></span><span className="text-slate-400">ALDI · IGA · Foodland <span className="ml-1 text-xs">Coming later</span></span></div><p className="mt-4 text-xs leading-6 text-slate-400">MyShoppingList is independent of these retailers. Comparison coverage varies by retailer. Some prices need verification. Existing list-item quantities stay unchanged when you import the same product again.</p></section>
    </main>
  </>;
}
