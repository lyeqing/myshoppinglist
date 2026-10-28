"use client";

import { useEffect, useRef, useState } from "react";
import { extensionRequest, ExtensionUnavailable, type ExtensionRefreshProgress } from "@/lib/extension-refresh";

export default function ExtensionRefreshControl({ accountId, listId, disabled, onReload, className }: {
  accountId?: number; listId: number | null; disabled?: boolean;
  onReload: () => Promise<unknown>; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const active = useRef<{ accountId: number; listId: number; runId: string } | null>(null);
  useEffect(() => () => {
    const run = active.current;
    active.current = null;
    if (run) void extensionRequest("cancel", run).catch(() => {});
  }, [accountId, listId]);

  async function refresh() {
    if (active.current || !accountId || !listId) return;
    const run = { accountId, listId, runId: crypto.randomUUID() };
    active.current = run;
    setBusy(true); setMissing(false); setError("");
    setNotice("Connecting to your extension…");
    try {
      const hello = await extensionRequest<{ available: boolean; version: number }>("hello");
      if (!hello?.available || hello.version !== 1) throw new ExtensionUnavailable("Update or reload your extension.");
      if (active.current !== run) return;
      // Keep the list reload useful for newly saved products as well.
      await onReload();
      if (active.current !== run) return;
      let progress = await extensionRequest<ExtensionRefreshProgress>("start", run);
      while (active.current === run && !progress.done) {
        setNotice(`Updating prices: ${progress.completed} of ${progress.total} checked. ${progress.updated} updated. ${progress.message}`);
        progress = await extensionRequest<ExtensionRefreshProgress>("next", run);
        if (active.current === run && progress.updated > 0) await onReload();
      }
      if (active.current !== run) return;
      await onReload();
      setNotice(progress.total === 0 ? "No eligible retailer products to update. Purchased and hidden items are skipped."
        : `${progress.updated} price ${progress.updated === 1 ? "observation" : "observations"} updated. ${progress.failed} could not be updated.${progress.failed ? " Previous observations were kept where a page could not be read." : ""} ${progress.message}`);
    } catch (e) {
      if (active.current !== run) return;
      void extensionRequest("cancel", run).catch(() => {});
      setNotice("");
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
    {missing && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800">
      <p className="font-semibold">Connect your extension to update prices</p>
      <p>We couldn’t connect to MyShoppingList’s extension. Use desktop Chrome, install or enable the extension in the same browser profile, then try again.</p>
      <div className="mt-2 flex flex-wrap gap-4">
        <button className="font-semibold underline" aria-expanded={instructions} onClick={() => setInstructions(!instructions)}>Installation instructions</button>
        <button className="font-semibold underline" disabled={busy || disabled} onClick={() => void refresh()}>Try again</button>
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
