"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { createAdminHealthStore } from "@/stores/admin-health-store";

const date = (value: string) => new Date(value).toLocaleString("en-AU");
function age(created: string | null, checked: string) {
  if (!created) return "No outstanding tasks";
  const minutes = Math.max(
    0,
    Math.floor((Date.parse(checked) - Date.parse(created)) / 60000),
  );
  return minutes < 60
    ? `${minutes} min`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
      : `${Math.floor(minutes / 1440)} days ${Math.floor((minutes % 1440) / 60)} hr`;
}
const statusNames = {
  Running: "Accepting shared work",
  Paused: "Paused after blocking",
  TrialRunning: "Recovery trial running",
  AwaitingTrial: "Waiting for recovery trial",
};

export default function AdminHealth() {
  const [store] = useState(createAdminHealthStore);
  const { data, busy, error, denied } = useStore(store);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && !store.getState().denied)
        void store.getState().load();
    };
    const visibility = () => {
      if (document.hidden) store.getState().cancel();
      else refresh();
    };
    const session = () => {
      store.getState().reset();
      refresh();
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("myshoppinglist-session-changed", session);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("myshoppinglist-session-changed", session);
      store.getState().cancel();
    };
  }, [store]);
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 text-slate-900 sm:p-6">
      <nav
        aria-label="Administration"
        className="flex flex-wrap gap-5 text-sm text-sky-700 underline"
      >
        <Link href="/admin">Account administration</Link>
        <Link href="/">MyShoppingList / sign in</Link>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Retailer health</h1>
          <p className="mt-2 text-slate-600">
            Shared background work for Coles and Woolworths.
          </p>
        </div>
        <button
          onClick={() => void store.getState().load()}
          disabled={busy}
          className="min-h-11 rounded-xl bg-sky-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Refreshing…" : "Refresh health"}
        </button>
      </div>
      <p className="text-sm text-slate-500">
        {denied
          ? "Automatic refresh stopped."
          : "Updates every 30 seconds while this page is visible."}{" "}
        {data && `Last updated ${date(data.checkedAt)}.`}
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"
        >
          {error}
          {data &&
            " Showing the last successful snapshot; these figures may be out of date."}
        </p>
      )}
      {!data && busy && <p role="status">Loading retailer health…</p>}
      {data && (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            {data.retailers.map((r) => (
              <section
                key={r.code}
                aria-label={`${r.name} health`}
                className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h2 className="text-2xl font-semibold">{r.name}</h2>
                <div
                  className={`rounded-xl p-3 text-sm ${r.workloadStatus === "Running" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}
                >
                  <p className="font-semibold">
                    {statusNames[r.workloadStatus]}
                  </p>
                  {r.workloadStatus === "Paused" && r.pausedUntil && (
                    <p className="mt-1">
                      Trial eligible after {date(r.pausedUntil)}.
                    </p>
                  )}
                  {r.workloadStatus === "TrialRunning" && r.trialExpiresAt && (
                    <p className="mt-1">
                      Trial lease expires {date(r.trialExpiresAt)}.
                    </p>
                  )}
                  {r.workloadStatus === "AwaitingTrial" && (
                    <p className="mt-1">
                      An available worker can run one trial after existing tasks
                      finish.
                    </p>
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-3">
                  {[
                    ["Waiting", r.waiting],
                    ["Processing", r.processing],
                    ["Failed", r.failed],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 p-3">
                      <dt className="text-sm text-slate-600">{label}</dt>
                      <dd className="mt-1 text-2xl font-bold">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm text-slate-600">
                  Processing capacity: {r.processing} /{" "}
                  {data.maxConcurrentTasks}. Waiting includes tasks cooling
                  down.
                </p>
                {r.expiredLeases > 0 && (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                    {r.expiredLeases} expired worker lease(s) awaiting queue
                    recovery.
                  </p>
                )}
                <div>
                  <h3 className="font-semibold">Oldest outstanding task age</h3>
                  <p className="mt-1">
                    {age(r.oldestOutstandingCreatedAt, data.checkedAt)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Measured from task creation, including any previous reuse or
                    retries.
                  </p>
                </div>
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="font-semibold">
                    Latest task outcomes · last 24 hours
                  </h3>
                  <p className="mt-2">
                    {r.completedLast24Hours} completed · {r.failedLast24Hours}{" "}
                    failed
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {r.completionPercent === null
                      ? "No completed or failed tasks in this window."
                      : `${r.completionPercent}% completed successfully among these outcomes.`}
                  </p>
                </div>
                <p className="text-sm">
                  {r.recentBlockedReports} blocked reports in the last{" "}
                  {data.blockedWindowMinutes} minutes retained by workload
                  protection.
                </p>
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="font-semibold">Common current failures</h3>
                  {r.commonFailures.length ? (
                    <ul className="mt-2 space-y-2">
                      {r.commonFailures.map((f) => (
                        <li
                          key={f.code}
                          className="flex justify-between gap-3 text-sm"
                        >
                          <span className="min-w-0 break-all">
                            {f.code.replaceAll("_", " ")}
                          </span>
                          <span className="font-semibold">{f.count}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      No recorded failures on waiting or failed tasks.
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            Outcomes since {date(data.outcomesSince)} use each retained task’s
            latest result, not a full attempt history. Completed searches may
            have no matching product. Failure reasons show up to five groups
            from current waiting and failed tasks. Personal Add comparisons are
            outside this shared queue view.
          </p>
        </>
      )}
    </main>
  );
}
