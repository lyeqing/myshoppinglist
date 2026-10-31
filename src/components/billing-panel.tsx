"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { Session } from "@/lib/api-types";

type Subscription = { id: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; monthlyAudCents: number };
type Snapshot = { subscriptions: Subscription[]; invoices: { id: string; status: string; paidCents: number; currency: string; receiptUrl: string | null }[];
  payments: { id: string; paidCents: number; refundedCents: number; currency: string }[] };
type Own = Snapshot & { enabled: boolean; checkoutConfigured: boolean; reconciledAt: string | null;
  entitlement: { source: string; activeListLimit: number; trialExpiresAt: string | null } };
type Admin = { estimatedTestMrrAudCents: number; scheduledCancellations: number; failedSubscriptions: number; canceledSubscriptions: number;
  pending: number; unmatched: number; capped: boolean; customers: { accountId: number; reconciledAt: string | null; snapshot: Snapshot }[] };
const money = (cents: number, currency = "AUD") => new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Not reconciled yet";
const button = "min-h-11 rounded-xl border px-4 py-2 font-semibold disabled:opacity-50";
function hostedUrl(value: string, host: string) { try { const u = new URL(value); return u.protocol === "https:" && u.hostname === host && !u.port && !u.username && !u.password ? u.href : null; } catch { return null; } }
function Records({ data }: { data: Snapshot }) {
  return <div className="space-y-5"><section><h2 className="text-xl font-semibold">Test subscriptions</h2>{!data.subscriptions.length && <p>No reconciled test subscription.</p>}{data.subscriptions.map(s => <div key={s.id} className="mt-3 rounded-xl border p-4"><p>{s.status.replaceAll("_", " ")}{s.cancelAtPeriodEnd ? " · cancellation scheduled" : ""}</p><p>Current period ends: {date(s.currentPeriodEnd)}</p><p>Estimated monthly recurring amount: {money(s.monthlyAudCents)}</p></div>)}</section>
    <section><h2 className="text-xl font-semibold">Test invoices and receipts</h2>{!data.invoices.length && <p>No reconciled test invoices.</p>}{data.invoices.map(i => <div key={i.id} className="mt-3 rounded-xl border p-4"><p>{i.status} · paid {money(i.paidCents, i.currency)}</p>{i.receiptUrl && hostedUrl(i.receiptUrl, "invoice.stripe.com") && <a className="inline-flex min-h-11 items-center underline" href={i.receiptUrl} rel="noreferrer" target="_blank">Open test invoice receipt</a>}</div>)}</section>
    <section><h2 className="text-xl font-semibold">Test payments and refunds</h2>{!data.payments.length && <p>No reconciled test payments.</p>}{data.payments.map(p => <p key={p.id} className="mt-3 rounded-xl border p-4">Paid {money(p.paidCents, p.currency)} · refunded {money(p.refundedCents, p.currency)}</p>)}</section>
  </div>;
}
export default function BillingPanel({ administrator = false }: { administrator?: boolean }) {
  const [own, setOwn] = useState<Own | null>(null), [admin, setAdmin] = useState<Admin | null>(null), [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const request = useRef<{ plan: string; id: string } | null>(null), active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    (async () => {
      if (administrator) { const data = await api<Admin>("/admin/billing", { signal: controller.signal }); if (!controller.signal.aborted) setAdmin(data); }
      else { const current = await api<Session>("/auth/me", { signal: controller.signal }); const data = await api<Own>("/billing", { signal: controller.signal }); if (!controller.signal.aborted) { setSession(current); setOwn(data); } }
    })().catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load billing."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const changed = () => { controller.abort(); request.current = null; setOwn(null); setAdmin(null); setSession(null); setError(""); setLoading(true); setBusy(false); setAttempt(v => v + 1); };
    window.addEventListener("myshoppinglist-session-changed", changed);
    return () => { controller.abort(); window.removeEventListener("myshoppinglist-session-changed", changed); };
  }, [administrator, attempt]);
  async function open(kind: "checkout" | "portal", plan = "monthly") {
    if (busy || !session || !active.current) return;
    const controller = active.current; setBusy(true); setError("");
    if (!request.current || request.current.plan !== plan) request.current = { plan, id: crypto.randomUUID() };
    try {
      const result = await api<{ url: string }>(`/billing/${kind}`, { method: "POST", signal: controller.signal,
        body: JSON.stringify({ expectedAccountId: session.account.id, requestId: request.current.id, plan }) });
      if (controller.signal.aborted) return;
      const url = hostedUrl(result.url, kind === "checkout" ? "checkout.stripe.com" : "billing.stripe.com");
      if (!url) throw new Error("The billing provider returned an unexpected link. Please contact support.");
      window.location.assign(url);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Test billing could not be opened."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <main className="mx-auto max-w-4xl space-y-6 px-5 py-8"><Link className="inline-flex min-h-11 items-center underline" href="/settings">Back to settings</Link><h1 className="text-3xl font-semibold">{administrator ? "Test billing administration" : "Billing"}</h1>
    <p className="rounded-xl border border-amber-300 bg-amber-50 p-4">Test environment only. No live payments are available. Test payments do not change your account access. Returning from checkout does not confirm payment.</p>
    <button className={button} disabled={busy || loading} onClick={() => { setOwn(null); setAdmin(null); setSession(null); setError(""); setLoading(true); setAttempt(v => v + 1); }}>Refresh billing</button>{loading && <p role="status">Loading billing…</p>}{error && <p role="alert" className="text-red-700">{error}</p>}
    {own && <><section><h2 className="text-xl font-semibold">Your current access</h2><p>{own.entitlement.source.replaceAll("_", " ")} · up to {own.entitlement.activeListLimit} active lists</p>{own.entitlement.source === "trial" && <p>Trial expires: {date(own.entitlement.trialExpiresAt)}</p>}<p>Last successful test reconciliation: {date(own.reconciledAt)}</p><p className="mt-2 text-sm text-slate-600">Subscription periods below are provider billing periods, not proof of paid-through access. Records can be delayed during outages. Cancellation and refunds in test mode leave your existing account limits unchanged.</p></section>
      {!own.enabled || !own.checkoutConfigured ? <p>Test checkout is not configured. Your current access remains available. <Link href="/support" className="underline">Contact support</Link> for help.</p> : <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || session?.account.isTrial} onClick={() => open("checkout")}>Open monthly test checkout</button><button className={button} disabled={busy || session?.account.isTrial} onClick={() => open("checkout", "annual")}>Open annual test checkout</button><button className={button} disabled={busy} onClick={() => open("portal")}>Manage test subscription</button></div>}
      <Records data={own} /></>}
    {admin && <><p>Test estimates only; no recognised revenue. Annual amounts are divided by 12 with fractional cents truncated. MRR includes active, unexpired subscriptions, including scheduled cancellations; excludes trials, past-due subscriptions and manual complimentary accounts. These are snapshots, not cohort churn rates.</p><dl className="grid gap-3 sm:grid-cols-3">{[["Estimated test MRR (AUD)", money(admin.estimatedTestMrrAudCents)], ["Scheduled cancellations", admin.scheduledCancellations], ["Failed subscriptions", admin.failedSubscriptions], ["Canceled subscriptions", admin.canceledSubscriptions], ["Pending reconciliation", admin.pending], ["Unmatched events · review required", admin.unmatched]].map(([label, value]) => <div key={label} className="rounded-xl border p-4"><dt>{label}</dt><dd className="mt-2 text-xl font-semibold">{value}</dd></div>)}</dl>{admin.capped && <p role="alert">Only the first 1,000 test customers are shown. Totals are partial.</p>}{!admin.customers.length && <p>No test billing customers.</p>}{admin.customers.map(c => <section className="space-y-4 rounded-xl border p-5" key={c.accountId}><h2 className="text-2xl font-semibold">Account {c.accountId}</h2><p>Last reconciled: {date(c.reconciledAt)}</p><Records data={c.snapshot} /></section>)}</>}
  </main>;
}
