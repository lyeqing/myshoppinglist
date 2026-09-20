"use client";
import { useState } from "react";
import type { ListItem, ListItemUpdate } from "@/lib/api-types";
import { ApiError } from "@/lib/api-client";

export default function ShoppingListItemCard({ item, hidden, save, reload }: {
  item: ListItem; hidden: boolean; save: (id: number, edit: ListItemUpdate) => Promise<ListItem>;
  reload: (id: number) => Promise<ListItem | null>;
}) {
  const [base, setBase] = useState(item);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [notes, setNotes] = useState(item.notes ?? "");
  const [purchased, setPurchased] = useState(item.isPurchased);
  const [isHidden, setHidden] = useState(item.isHidden);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  function accept(value: ListItem) {
    setBase(value); setQuantity(String(value.quantity)); setNotes(value.notes ?? "");
    setPurchased(value.isPurchased); setHidden(value.isHidden); setConflict(false); setError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 2147483647 || notes.length > 4000) { setError("Enter a positive whole-number quantity and notes of at most 4,000 characters."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      accept(await save(item.id, { quantity: qty, notes: notes || null, isPurchased: purchased, isHidden,
        expectedUpdatedDate: base.updatedDate })); setNotice("Changes saved.");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setConflict(e instanceof ApiError && e.status === 409);
      setError(e instanceof Error ? e.message : "Unable to save. Your edits are still here.");
    } finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setError(""); setNotice("");
    try { const latest = await reload(item.id); if (latest) { accept(latest); setNotice("Latest saved version loaded."); } else setError("This item is no longer available."); }
    catch (e) { if (!(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Unable to reload."); }
    finally { setBusy(false); }
  }
  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-60";
  return <div hidden={hidden} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" role="group" aria-label={`Edit ${item.product.name}`}>
    <p className="wrap-break-word font-semibold">{item.product.name}</p>
    <p className="mt-1 text-xs text-slate-500">{item.product.brand}{item.isPurchased ? " · Purchased" : " · To buy"}{item.isHidden ? " · Hidden" : ""}</p>
    <form onSubmit={submit} className="mt-4 space-y-3">
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-sm">Item quantity<input aria-label="Item quantity" className={`${field} mt-1 max-w-32 block`} type="number" min={1} max={2147483647} step={1} required value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
        <label className="block text-sm">Notes<textarea aria-label="Notes" className={`${field} mt-1`} rows={2} maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={purchased} onChange={e => setPurchased(e.target.checked)} />Purchased</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={isHidden} onChange={e => setHidden(e.target.checked)} />Hidden</label>
        </div>
      </fieldset>
      {(conflict || base.updatedDate !== item.updatedDate) && <p className="text-sm text-amber-800">A newer saved version is available. Your edits are kept here. Loading the latest version replaces these unsaved edits.</p>}
      {error && <p role="alert" className="text-sm text-amber-800">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy || conflict || base.updatedDate !== item.updatedDate} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Working…" : "Save changes"}</button>
        <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">Load latest saved version</button>
      </div>
    </form>
  </div>;
}
