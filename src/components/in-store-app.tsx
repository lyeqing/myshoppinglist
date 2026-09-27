"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "zustand";
import { createInStoreStore, itemGroup } from "@/stores/in-store-store";

const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
const button = "min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const tones = ["border-emerald-200 bg-emerald-50 text-emerald-950", "border-sky-200 bg-sky-50 text-sky-950", "border-slate-200 bg-slate-50 text-slate-800", "border-amber-200 bg-amber-50 text-amber-950", "border-slate-200 bg-white text-slate-600"];

export default function InStoreApp() {
  const [store] = useState(createInStoreStore);
  const state = useStore(store);
  const { load, dispose } = state;
  useEffect(() => { void load(null); return dispose; }, [load, dispose]);
  const retailers = state.detail?.retailers ?? [...new Map(state.lists.flatMap(l => l.retailers).map(s => [s.id, s])).values()];
  const selected = retailers.find(s => s.id === state.shopId);
  const detail = state.detail;
  const disabled = state.loading || state.saving;
  const rows = detail?.items.filter(row => state.showPurchased || !row.item.isPurchased).slice().sort((a, b) =>
    (selected ? itemGroup(a, selected.id) - itemGroup(b, selected.id) : 0) || a.item.product.name.localeCompare(b.item.product.name)) ?? [];
  const labels = [`Cheaper at ${selected?.name}`, `${selected?.name} price only`, "Same price", "Better price elsewhere", "Price unavailable"];
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4">
      <Link href="/" className="font-semibold text-sky-800">MyShoppingList</Link><Link href="/" className={button}>Manage my lists</Link>
    </div></header>
    <main className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-widest text-sky-700">Your shopping companion</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Shop in store</h1>
      <p className="mt-2 text-sm text-slate-600">Estimated—prices may vary by store. Fresh prices follow the Wednesday catalogue cycle.</p>
      <section aria-label="Choose retailer" className="sticky top-0 z-10 my-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label htmlFor="retailer" className="mb-2 block text-sm font-semibold">Where are you shopping?</label>
        <div className="flex flex-wrap gap-3"><select id="retailer" value={state.shopId ?? ""} disabled={disabled || !retailers.length}
          onChange={e => state.selectShop(e.target.value ? Number(e.target.value) : null)} className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3">
          <option value="">Choose a retailer</option>{retailers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select><button className={button} disabled={disabled} onClick={() => void load()}>Refresh prices</button></div>
        {!state.loading && !retailers.length && <p className="mt-2 text-sm text-slate-500">No retailer matches saved yet.</p>}
      </section>
      {state.error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4"><p>{state.error}</p>
        {state.unauthorized ? <Link href="/" className="mt-3 inline-block underline">Sign in</Link> : <button className={`${button} mt-3`} onClick={() => void load()} disabled={disabled}>Retry</button>}</div>}
      {state.loading && <p role="status" className="mb-4">Loading your shopping lists…</p>}
      {state.saving && <p role="status" className="mb-4">Saving purchase…</p>}
      {!state.selectedList && !state.unauthorized && <section aria-label="Your lists"><h2 className="mb-4 text-xl font-semibold">Your lists</h2>
        <div className="grid gap-4 sm:grid-cols-2">{state.lists.map(list => <button key={list.id} disabled={disabled} onClick={() => void load(list.id)}
          className="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-sky-500 disabled:opacity-50">
          <span className="block text-lg font-semibold">{list.name}</span><span className="mt-2 block text-sm text-slate-500">{list.remainingCount} items remaining</span>
          <span className="mt-3 block text-xs text-sky-700">{list.retailers.map(s => s.name).join(" · ") || "Awaiting retailer matches"}</span>
        </button>)}</div>{!state.loading && !state.lists.length && <p>No shopping lists yet. <Link href="/" className="underline">Add products to get started.</Link></p>}
      </section>}
      {state.selectedList && <button className={`${button} mb-4`} disabled={disabled} onClick={() => void load(null)}>← All lists</button>}
      {detail && <>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold">{detail.name}</h2><p className="text-sm text-slate-500">{detail.remainingCount} items remaining</p></div>
          <button className={button} aria-pressed={state.showPurchased} onClick={state.togglePurchasedVisibility}>{state.showPurchased ? "Hide purchased" : "Show purchased"}</button></div>
        <section aria-label="Basket estimates" className="mb-7 rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-lg font-semibold">Plan your shop</h3><p className="mt-1 text-xs text-slate-500">Remaining items only. Totals include requested quantities.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">{detail.baskets.map(b => <div key={b.shopId} className="rounded-xl bg-slate-50 p-4"><p className="text-sm font-medium">Only {b.shopName}</p><p className="mt-1 text-2xl font-semibold">{money(b.subtotal)}</p><p className="text-xs text-slate-500">{b.pricedCount === detail.remainingCount ? "Estimated total" : "Subtotal"} · {b.pricedCount} of {detail.remainingCount} items priced</p></div>)}
            <div className="rounded-xl bg-emerald-50 p-4"><p className="text-sm font-medium">Cheapest across retailers</p><p className="mt-1 text-2xl font-semibold text-emerald-800">{money(detail.splitSubtotal)}</p><p className="text-xs text-emerald-900">{detail.splitPricedCount === detail.remainingCount ? "Estimated total" : "Subtotal"} · {detail.splitPricedCount} of {detail.remainingCount} items priced</p></div>
          </div>
          {detail.comparableCount > 0 ? <div className="mt-4 text-sm"><p>For the {detail.comparableCount} items priced at both retailers, splitting costs {money(detail.comparableSplitSubtotal)}.</p>
            {detail.baskets.map(b => <p key={b.shopId}>Save {money(b.savingsBySplitting)} compared with {b.shopName} only ({money(b.comparableSubtotal)} for those same items).</p>)}</div>
            : <p className="mt-4 text-sm text-slate-500">Savings need fresh prices at both retailers for the same items.</p>}
        </section>
        {!selected && <p className="mb-4 text-sm text-slate-600">Choose a retailer above to put its best buys first.</p>}
        <div className="space-y-4">{rows.map((row, index) => {
          const group = selected ? itemGroup(row, selected.id) : 4;
          const prices = row.prices.filter(p => p.price !== null).sort((a, b) => a.price! - b.price!);
          const best = prices[0]; const second = prices[1];
          const heading = selected && (index === 0 || itemGroup(rows[index - 1], selected.id) !== group);
          return <div key={row.item.id}>{heading && <h3 className="mb-3 mt-6 text-base font-semibold">{labels[group]}</h3>}
            <article className={`rounded-2xl border p-5 ${tones[group]} ${row.item.isPurchased ? "opacity-65" : ""}`}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words text-lg font-semibold">{row.item.product.name}</h4>
                <p className="mt-1 text-sm">{[row.item.product.brand, row.item.product.variant].filter(Boolean).join(" · ")} · Quantity {row.item.quantity}</p>
                {row.item.product.packSize != null && <p className="mt-1 text-xs">{row.item.product.packQuantity && row.item.product.packQuantity > 1 ? `${row.item.product.packQuantity} × ` : ""}{row.item.product.packSize}{row.item.product.packUnit}</p>}
                {row.item.notes && <p className="mt-2 break-words text-sm">{row.item.notes}</p>}</div>
                <label className="flex min-h-11 shrink-0 cursor-pointer flex-col items-center gap-1 text-xs"><input type="checkbox" className="size-6 accent-sky-700" checked={row.item.isPurchased} disabled={disabled}
                  aria-label={`Purchased ${row.item.product.name}`} onChange={() => void state.purchase(row)} />Purchased</label>
              </div>
              {best ? <div className="mt-4"><p className="text-sm">{second?.price === best.price ? `Equal best: ${prices.filter(p => p.price === best.price).map(p => p.shopName).join(" & ")}` : `Best price: ${best.shopName}`}</p>
                <p className="text-2xl font-semibold">{money(best.price!)} <span className="text-xs font-normal">each · {money(best.price! * row.item.quantity)} for your quantity</span></p>
                {second && <p className="mt-2 text-sm">Second price: {second.shopName} {money(second.price!)} · Save {money((second.price! - best.price!) * row.item.quantity)} on your quantity</p>}</div>
                : <p className="mt-4 text-sm">No fresh comparable price available.</p>}
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-current/10 pt-3 text-xs">{row.prices.map(p => <p key={p.shopId}>{p.shopName}: {p.price === null ? p.status : money(p.price)}{p.checkedDate && <span className="block opacity-70">Checked {new Date(p.checkedDate).toLocaleString("en-AU")}</span>}</p>)}</div>
            </article></div>;
        })}</div>
        {!rows.length && <p className="rounded-2xl bg-white p-6">{detail.items.length ? "All done! Your remaining shopping list is empty." : "This list has no visible products yet."}</p>}
      </>}
    </main>
  </div>;
}
