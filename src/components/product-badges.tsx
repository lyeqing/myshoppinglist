"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useStore } from "zustand";
import { useProductLibraryStore } from "./product-library-provider";

export default function ProductBadges({ accountId, productId, name }: { accountId?: number; productId: number; name: string }) {
  const store = useProductLibraryStore();
  const owner = useStore(store, (state) => state.accountId);
  const entry = useStore(store, (state) => state.accountId === accountId ? state.entries[productId] : undefined);
  useEffect(() => {
    if (accountId) { store.getState().activate(accountId); store.getState().ensure(accountId, productId); }
  }, [store, accountId, productId]);
  useEffect(() => {
    if (accountId && owner === null) { store.getState().activate(accountId); store.getState().ensure(accountId, productId); }
  }, [store, accountId, productId, owner]);
  return (
    <div className="mt-3" role="group" aria-label={`Saved settings for ${name}`}>
      <div className="flex flex-wrap gap-2">
        {(["favorite", "essential"] as const).map((kind) => {
          const selected = kind === "favorite" ? entry?.value?.isFavorite : entry?.value?.isEssential;
          const label = kind === "favorite" ? "Favorite" : "Essential";
          return <button key={kind} type="button" aria-pressed={!!selected}
            aria-label={`${selected ? "Remove" : "Add"} ${name} ${selected ? "from" : "to"} ${kind === "favorite" ? "Favorites" : "Essentials"}`}
            title={kind === "essential" ? "Automatically add quantity 1 to each new shopping list" : "Save this product for easy reuse"}
            disabled={!accountId || !entry?.value || entry.loading || entry.saving}
            onClick={() => void store.getState().toggle(accountId!, productId, kind)}
            className={`min-h-11 rounded-full border px-3 py-2 text-xs font-semibold disabled:opacity-60 ${selected ? kind === "favorite" ? "border-amber-500 bg-amber-50 text-amber-900" : "border-primary-300 bg-primary-100 text-primary-700" : "border-slate-300 bg-white text-slate-600"}`}>
            <span aria-hidden="true">{kind === "favorite" ? selected ? "★" : "☆" : selected ? "✓" : "+"}</span> {label}
          </button>;
        })}
      </div>
      {(entry?.loading || entry?.saving) && <p role="status" className="mt-1 text-xs text-slate-500">{entry.saving ? "Saving product settings…" : "Loading product settings…"}</p>}
      {entry?.notice && <p role="status" className="mt-1 text-xs text-primary-700">{entry.notice}</p>}
      {entry?.error && <p role={entry.value ? "alert" : "status"} className="mt-1 text-xs text-amber-900">{entry.error}{" "}
        {entry.needsAccount ? <Link href="/" className="underline">Create an account</Link> : !entry.value && <button type="button" className="min-h-11 underline" onClick={() => store.getState().ensure(accountId!, productId)}>Retry product settings</button>}
      </p>}
    </div>
  );
}
