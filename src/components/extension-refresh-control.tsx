"use client";

import { useEffect, useRef, useState } from "react";
import { extensionRequest, ExtensionUnavailable, isExtensionReady, rememberExtensionId,
  type ExtensionRefreshProgress, type ExtensionRefreshTarget } from "@/lib/extension-refresh";

function retailerLink(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port
        && ["coles.com.au", "woolworths.com.au", "aldi.com.au"].includes(url.hostname.replace(/^www\./, ""))) return url.href;
  } catch { /* Only supported retailer links may be opened. */ }
  return null;
}

export default function ExtensionRefreshControl({ accountId, listId, disabled, onReload, className }: {
  accountId?: number; listId: number | null; disabled?: boolean;
  onReload: () => Promise<unknown>; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<ExtensionRefreshProgress | null>(null);
  const active = useRef<{ accountId: number; listId: number; runId: string } | null>(null);
  useEffect(() => () => {
    const run = active.current;
    active.current = null;
    if (run) void extensionRequest("cancel", run).catch(() => {});
  }, [accountId, listId]);
  useEffect(() => {
    let alive = true;
    const ready = async (event: MessageEvent) => {
      if (!isExtensionReady(event)) return;
      rememberExtensionId(event.data.extensionId);
      if (!missing || active.current) return;
      try {
        const hello = await extensionRequest<{ available: boolean; version: number }>("hello");
        if (alive && !active.current && hello?.available && hello.version === 2) {
          setMissing(false);
          setNotice("Extension reconnected. Click Refresh items or retry unfinished items to continue.");
        }
      } catch { /* Keep recovery controls available. */ }
    };
    window.addEventListener("message", ready);
    return () => { alive = false; window.removeEventListener("message", ready); };
  }, [missing, accountId, listId]);

  async function refresh(targets?: ExtensionRefreshTarget[]) {
    if (active.current || !accountId || !listId) return;
    const run = { accountId, listId, runId: crypto.randomUUID() };
    active.current = run;
    setBusy(true); setMissing(false); setError("");
    setNotice("Connecting to your extension…");
    let latest = progress;
    try {
      const hello = await extensionRequest<{ available: boolean; version: number }>("hello");
      if (!hello?.available || hello.version !== 2) throw new ExtensionUnavailable("Update or reload your extension.");
      if (active.current !== run) return;
      // Keep the list reload useful for newly saved products as well.
      await onReload();
      if (active.current !== run) return;
      latest = await extensionRequest<ExtensionRefreshProgress>("start", { ...run,
        ...(targets ? { targets: targets.map(({ itemId, mappingId }) => ({ itemId, mappingId })) } : {}) });
      if (active.current !== run) return;
      setProgress(latest);
      while (active.current === run && !latest.done) {
        setNotice(`Updating prices: ${latest.completed} of ${latest.total} checked. ${latest.updated} updated. ${latest.message}`);
        latest = await extensionRequest<ExtensionRefreshProgress>("next", run);
        if (active.current !== run) return;
        setProgress(latest);
        if (latest.updated > 0) await onReload();
      }
      if (active.current !== run) return;
      await onReload();
      setNotice(latest.total === 0 ? (targets ? "These products are no longer eligible for refresh. They may have been removed, purchased or hidden."
        : "No eligible retailer products to update. Purchased and hidden items are skipped.")
        : `${targets ? "Retry complete. " : ""}${latest.updated} price ${latest.updated === 1 ? "observation" : "observations"} updated. ${latest.failed} could not be updated.${latest.failed ? " Previous observations were kept where a page could not be read." : ""}`);
    } catch (e) {
      if (active.current !== run) return;
      void extensionRequest("cancel", run).catch(() => {});
      setNotice(latest ? `${latest.updated} ${latest.updated === 1 ? "update" : "updates"} confirmed before interruption. Updates already saved have been kept. Unfinished results below may need checking.` : "");
      if (e instanceof ExtensionUnavailable) { setMissing(true); await onReload().catch(() => {}); }
      else setError(e instanceof Error ? e.message : "Prices could not be updated. Try again.");
    } finally {
      if (active.current === run) { active.current = null; setBusy(false); }
    }
  }
  async function cancel() {
    const run = active.current;
    if (!run) return;
    active.current = null;
    setNotice("Stopping refresh…");
    try {
      await extensionRequest("cancel", run);
      setNotice("Refresh cancelled. Updates already saved have been kept.");
    } catch {
      setNotice("Further reads stopped. The extension could not confirm cancellation of its current update. Updates already saved have been kept.");
    }
    await onReload().catch(() => {});
    setBusy(false);
  }
  return <div className="max-w-xl space-y-2">
    <div className="flex flex-wrap items-center gap-3">
      <button className={className ?? "text-sm font-semibold text-sky-700 disabled:opacity-50"}
        disabled={disabled || busy || !accountId || !listId} onClick={() => void refresh()}>
        {busy ? "Updating items…" : "Refresh items"}
      </button>
      {busy && <button className="text-sm font-semibold text-slate-700 underline" onClick={() => void cancel()}>Cancel refresh</button>}
    </div>
    {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
    {error && <p role="alert" className="text-sm text-amber-800">{error} You can try Refresh items again.</p>}
    {!!progress?.failures?.length && <section aria-label="Products that could not be updated" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-semibold">Products that could not be updated</p>
      <ul className="mt-2 space-y-3">{progress.failures.map(failure => <li key={`${failure.itemId}-${failure.mappingId}`}>
        <p className="font-semibold">{failure.name}</p><p>{failure.message}</p>
        {retailerLink(failure.url) && <a href={retailerLink(failure.url)!} target="_blank" rel="noopener noreferrer"
          className="font-semibold underline" aria-label={`Open product: ${failure.name} (new tab)`}>Open product</a>}
      </li>)}</ul>
    </section>}
    {!busy && !!progress?.pending?.length && <section aria-label="Unfinished price updates" className="rounded-xl border border-slate-200 p-3 text-sm">
      <p className="font-semibold">Unfinished price updates</p>
      <p>These products were not checked or their latest outcome was not confirmed.</p>
      <ul className="mt-2 space-y-2">{progress.pending.map(target => <li key={`${target.itemId}-${target.mappingId}`}>
        <span>{target.name}</span>{" "}{retailerLink(target.url) && <a href={retailerLink(target.url)!} target="_blank" rel="noopener noreferrer"
          className="underline" aria-label={`Open product: ${target.name} (new tab)`}>Open product</a>}
      </li>)}</ul>
    </section>}
    {!busy && !!((progress?.failures?.length ?? 0) + (progress?.pending?.length ?? 0)) && <button
      disabled={disabled || missing} className="text-sm font-semibold text-sky-700 underline disabled:opacity-50"
      onClick={() => void refresh([...(progress?.failures ?? []), ...(progress?.pending ?? [])])}>
      {progress?.pending?.length ? "Retry unfinished items" : "Retry failed items"}
    </button>}
    {missing && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800">
      <p className="font-semibold">Connect your extension to update prices</p>
      <p>We couldn’t connect to MyShoppingList’s extension. Use desktop Chrome, install or enable the extension in the same browser profile, then try again.</p>
      <p className="mt-2">If you just updated or reloaded the extension, it should reconnect automatically. If it does not, reload this page. Reloading clears unsaved edits.</p>
      <div className="mt-2 flex flex-wrap gap-4">
        <button className="font-semibold underline" aria-expanded={instructions} onClick={() => setInstructions(!instructions)}>Installation instructions</button>
        <button className="font-semibold underline" disabled={busy || disabled} onClick={() => void refresh()}>Try again</button>
        <button className="font-semibold underline" onClick={() => window.location.reload()}>Reload this page</button>
      </div>
      {instructions && <div className="mt-3 space-y-2">
        <p>This extension is currently an unpacked local test, with no Chrome Web Store listing.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>In Chrome, open <code>chrome://extensions</code>. If MyShoppingList is listed, turn it on. After an extension update, click its Reload button.</li>
          <li>To install it, enable Developer mode, choose Load unpacked, and select the <code>extensions/shopping-list</code> folder supplied with this app.</li>
          <li>The app owner must allow this extension’s ID in the API configuration. Use the same Chrome profile as this website.</li>
          <li>Reload this website tab, then click Refresh items again.</li>
        </ol>
      </div>}
    </div>}
  </div>;
}
