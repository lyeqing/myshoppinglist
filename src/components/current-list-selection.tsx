"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { ShoppingListManagement, ShoppingListSummary } from "@/lib/api-types";

type Selection = { selectionVersion: number; list: ShoppingListSummary | null; status: string };
export default function CurrentListSelection({ accountId }: { accountId: number }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [lists, setLists] = useState<ShoppingListSummary[]>([]);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api<Selection>("/account/current-list", { signal: controller.signal }), api<ShoppingListManagement>("/shopping-lists/manage", { signal: controller.signal })])
      .then(([current, management]) => { setSelection(current); setLists(management.lists); setChoice(String(current.list?.id ?? "")); setError(""); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load your lists."); });
    return () => controller.abort();
  }, [accountId, attempt]);
  async function save() {
    if (!selection || !choice || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const current = await api<Selection>("/account/current-list", { method: "PUT", body: JSON.stringify({ expectedAccountId: accountId, shoppingListId: Number(choice), expectedSelectionVersion: selection.selectionVersion }) });
      setSelection(current); setNotice("Current list saved for your website, extension and AI connections.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to select this list. Refresh and try again."); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="current-list-title" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
    <h2 id="current-list-title" className="text-xl font-semibold">Current shopping list</h2>
    <p className="mt-2 text-sm text-slate-600">Choose the list your AI apps should use by default. The website and extension open this list when they next load your account. Viewing another list does not change this selection.</p>
    {!selection && !error && <p role="status" className="mt-3 text-sm">Loading your lists…</p>}
    {selection?.status === "selection_unavailable" && <p className="mt-3 text-sm text-amber-800">Your previous current list is no longer available. Choose another list.</p>}
    {selection && <div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 text-sm font-medium">Current list<select value={choice} disabled={busy || !lists.length} onChange={e => setChoice(e.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 p-3"><option value="">Choose a list</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label><button disabled={busy || !choice || Number(choice) === selection.list?.id} onClick={() => void save()} className="rounded-xl bg-primary-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save current list"}</button></div>}
    {selection && !lists.length && <p className="mt-3 text-sm">Create an active list in My lists, then choose it here.</p>}
    {notice && <p role="status" className="mt-3 text-sm text-primary-700">{notice}</p>}
    {error && <div className="mt-3 text-sm text-amber-800"><p role="alert">{error}</p><button disabled={busy} onClick={() => setAttempt(value => value + 1)} className="mt-2 font-semibold underline">Reload current list</button></div>}
  </section>;
}
