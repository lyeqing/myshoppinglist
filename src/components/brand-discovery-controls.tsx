"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api-client";
import type { BrandDiscoveryProgress, BrandDiscoveryView } from "@/lib/api-types";

type Props = {
  accountId?: number;
  listId: number;
  itemId?: number;
  disabled?: boolean;
  onDiscovered: () => Promise<unknown>;
};
const active = (job: BrandDiscoveryProgress) =>
  ["Queued", "Processing", "WaitingForExtension"].includes(job.status);
function status(job: BrandDiscoveryProgress) {
  if (job.status === "Queued") return "Queued";
  if (job.status === "Processing") return "Checking alternative brands…";
  if (job.status === "WaitingForExtension")
    return "Waiting for an online reader extension";
  if (job.status === "Cancelled")
    return "Search stopped because this item or its settings changed";
  if (job.status === "Failed")
    return job.foundCount > 0
      ? `${job.foundCount} suggestion${job.foundCount === 1 ? "" : "s"} saved; some checks could not finish`
      : "Check could not finish. Existing prices are kept";
  return job.foundCount > 0
    ? `${job.foundCount} suggestion${job.foundCount === 1 ? "" : "s"} checked`
    : "No suitable alternative brands found in this check";
}
export default function BrandDiscoveryControls(props: Props) {
  return props.accountId ? (
    <Controls
      key={`${props.accountId}-${props.listId}-${props.itemId ?? "list"}`}
      {...props}
      accountId={props.accountId}
    />
  ) : null;
}
function Controls({
  accountId,
  listId,
  itemId,
  disabled,
  onDiscovered,
}: Props & { accountId: number }) {
  const [view, setView] = useState<BrandDiscoveryView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const detailsId = useId();
  const runner = useRef<{
    start: () => Promise<void>;
    read: () => Promise<void>;
  } | null>(null);
  const callback = useRef(onDiscovered);
  useEffect(() => {
    callback.current = onDiscovered;
  }, [onDiscovered]);
  useEffect(() => {
    const controller = new AbortController();
    let sequence = 0;
    let writing = false;
    let previous: BrandDiscoveryView | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const path = `/shopping-lists/${listId}${itemId ? `/items/${itemId}` : ""}/brand-discovery`;
    const owns = (value: BrandDiscoveryView) =>
      value.accountId === accountId &&
      value.listId === listId &&
      value.itemId === (itemId ?? null);
    const fail = (e: unknown) => {
      if (
        controller.signal.aborted ||
        (e instanceof Error && e.name === "AbortError")
      )
        return;
      if (e instanceof ApiError && [401, 404].includes(e.status)) {
        setUnavailable(true);
        setView(null);
        return;
      }
      setError(
        e instanceof Error
          ? e.message
          : "Alternative-brand search is unavailable. Try again.",
      );
    };
    const accept = async (value: BrandDiscoveryView) => {
      if (!owns(value)) {
        setView(null);
        setUnavailable(true);
        return;
      }
      const finished = previous?.jobs.some(
        (old) =>
          active(old) &&
          value.jobs.some((job) => job.id === old.id && !active(job)),
      );
      previous = value;
      setView(value);
      setUnavailable(false);
      setError("");
      if (finished) await callback.current().catch(() => {});
    };
    const schedule = () => {
      clearTimeout(timer);
      if (!controller.signal.aborted)
        timer = setTimeout(
          () => {
            if (document.visibilityState === "visible") void read();
            else schedule();
          },
          previous?.jobs.some(active) ? 3000 : 30000,
        );
    };
    const read = async () => {
      if (writing || controller.signal.aborted) return;
      const version = ++sequence;
      try {
        const value = await api<BrandDiscoveryView>(path, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted && version === sequence)
          await accept(value);
      } catch (e) {
        if (version === sequence) fail(e);
      } finally {
        schedule();
      }
    };
    const start = async () => {
      if (writing || controller.signal.aborted) return;
      writing = true;
      const version = ++sequence;
      clearTimeout(timer);
      setBusy(true);
      setDetailsExpanded(true);
      setError("");
      setNotice("");
      try {
        const value = await api<BrandDiscoveryView>(path, {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ expectedAccountId: accountId }),
        });
        if (!controller.signal.aborted && version === sequence) {
          await accept(value);
          if (owns(value)) {
            setNotice(
              value.queued
                ? `${value.queued} store check${value.queued === 1 ? "" : "s"} queued. Your list and totals stay unchanged.`
                : value.alreadyRunning
                  ? "Alternative-brand searches are already in progress."
                  : value.recent
                    ? "Recent checks reused. Saved prices keep their original check dates."
                    : (value.reason ??
                      "No eligible products or stores to search."),
            );
            await callback.current().catch(() => {});
          }
        }
      } catch (e) {
        if (version === sequence) fail(e);
      } finally {
        writing = false;
        if (!controller.signal.aborted) {
          setBusy(false);
          schedule();
        }
      }
    };
    runner.current = { start, read };
    const focus = () => {
      if (document.visibilityState === "visible") void read();
    };
    const changed = () => {
      controller.abort();
      clearTimeout(timer);
      setView(null);
      setNotice("");
      setError("");
      setUnavailable(true);
    };
    window.addEventListener("focus", focus);
    window.addEventListener("myshoppinglist-session-changed", changed);
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("myshoppinglist-session-changed", changed);
      runner.current = null;
    };
  }, [accountId, listId, itemId]);
  const current =
    view?.accountId === accountId &&
    view.listId === listId &&
    view.itemId === (itemId ?? null)
      ? view
      : null;
  if (unavailable || (!current && !error)) return null;
  const jobs = current?.jobs ?? [];
  const pending = jobs.filter(active).length;
  const completed = jobs.filter((job) => job.status === "Completed").length;
  const failed = jobs.filter((job) => job.status === "Failed").length;
  const cancelled = jobs.filter((job) => job.status === "Cancelled").length;
  const summary = [
    pending ? `${pending} in progress` : "",
    completed ? `${completed} completed` : "",
    failed ? `${failed} unsuccessful` : "",
    cancelled ? `${cancelled} stopped` : "",
  ].filter(Boolean).join(" · ");
  return (
    <section
      aria-label={
        itemId
          ? "Find alternative brands for this product"
          : "Find alternative brands for this list"
      }
      className="my-3 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-slate-900"
    >
      <button
        type="button"
        disabled={disabled || busy || !current?.canStart}
        onClick={() => void runner.current?.start()}
        className="min-h-11 rounded-lg border border-sky-700 bg-white px-3 py-2 font-semibold text-sky-800 disabled:opacity-50"
      >
        {busy
          ? "Queuing alternative search…"
          : itemId
            ? "Find alternative brands"
            : "Find alternative brands for this list"}
      </button>
      {current?.reason && <p className="mt-2 text-xs">{current.reason}</p>}
      {!current?.enabled && current && (
        <Link
          href="/settings"
          className="mt-2 inline-block min-h-11 py-2 font-semibold text-sky-800 underline"
        >
          Manage alternative-brand comparisons
        </Link>
      )}
      {notice && (
        <p role="status" className="mt-2">
          {notice}
        </p>
      )}
      {!!current?.jobs.length && (
        <>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3">
            <p role="status" className="text-xs text-slate-600">
              Store checks: {summary}.
            </p>
            <button
              type="button"
              aria-expanded={detailsExpanded}
              aria-controls={detailsId}
              onClick={() => setDetailsExpanded((expanded) => !expanded)}
              className="min-h-11 py-2 font-semibold text-sky-800 underline"
            >
              {detailsExpanded ? "Hide search details" : "Show search details"}
            </button>
          </div>
          <ul
            id={detailsId}
            hidden={!detailsExpanded}
            aria-label="Alternative-brand store checks"
            className="mt-3 max-h-60 space-y-2 overflow-y-auto"
          >
            {current.jobs.map((job) => (
              <li key={job.id}>
                <p className="wrap-break-word">
                  <span className="font-semibold">
                    {!itemId && `${job.productName} · `}
                    {job.shopName}:
                  </span>{" "}
                  {status(job)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Search updated{" "}
                  {new Date(job.updatedDate).toLocaleString("en-AU")}
                  {job.retryAfter &&
                    ` · Retry after ${new Date(job.retryAfter).toLocaleString("en-AU")}`}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <>
          <p role="alert" className="mt-2 text-amber-900">
            {error}
          </p>
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => void runner.current?.read()}
            className="mt-2 min-h-11 font-semibold text-sky-800 underline"
          >
            Reload alternative search
          </button>
        </>
      )}
      {current?.enabled && (
        <p className="mt-2 text-xs text-slate-600">
          Checks a limited set of results in your selected supported stores.
          Recent searches may be reused. Price dates appear with each option.
        </p>
      )}
    </section>
  );
}
