"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { ListItem, ListItemPage, ListItemUpdate } from "@/lib/api-types";
import ShoppingListItemCard from "./shopping-list-item-card";

export default function ShoppingListItems({ listId, refreshKey, onExpired }: { listId: number; refreshKey: string; onExpired: (message: string) => void }) {
  const [items, setItems] = useState<ListItem[]>([]);
  const latestItems = useRef<ListItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [showPurchased, setShowPurchased] = useState(true);
  const lifetime = useRef<AbortController | null>(null);
  const readVersion = useRef(0);
  const updateItems = useCallback((value: ListItem[]) => { latestItems.current = value; setItems(value); }, []);
  const handle = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) onExpired(e.message);
    else if (!(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Unable to load your items.");
  }, [onExpired]);
  const load = useCallback(async (before: number | null = null, targetId?: number): Promise<ListItem | null> => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return null;
    const version = ++readVersion.current;
    setLoading(true); setError("");
    try {
      const oldest = Math.min(targetId ?? Infinity, ...latestItems.current.map(i => i.id));
      let next = before;
      const found: ListItem[] = [];
      do {
        const page = await api<ListItemPage>(`/shopping-lists/${listId}/items?pageSize=20&includeHidden=true&includePurchased=true${next ? `&beforeId=${next}` : ""}`, { signal });
        found.push(...page.items); next = page.nextBeforeId;
      } while (before === null && next !== null && next > oldest);
      if (signal.aborted || version !== readVersion.current) throw new DOMException("Read superseded", "AbortError");
      const merged = before === null ? found : [...latestItems.current, ...found];
      updateItems([...new Map(merged.map(i => [i.id, i])).values()].sort((a, b) => b.id - a.id));
      setCursor(next);
      return found.find(i => i.id === targetId) ?? null;
    } catch (e) { if (version === readVersion.current && !signal.aborted) handle(e); throw e; }
    finally { if (version === readVersion.current && !signal.aborted) setLoading(false); }
  }, [listId, handle, updateItems]);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => { void load().catch(() => {}); }, [load, refreshKey]);
  async function save(id: number, edit: ListItemUpdate) {
    const signal = lifetime.current!.signal;
    // Invalidate older GET responses so a pre-save snapshot cannot replace a successful edit.
    readVersion.current++; setLoading(false);
    try {
      const saved = await api<ListItem>(`/shopping-lists/${listId}/items/${id}`, { method: "PUT", body: JSON.stringify(edit), signal });
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      readVersion.current++;
      setLoading(false);
      updateItems(latestItems.current.map(i => i.id === id ? saved : i));
      return saved;
    } catch (e) { if (!signal.aborted && e instanceof ApiError && e.status === 401) onExpired(e.message); throw e; }
  }
  const visible = items.filter(i => (showHidden || !i.isHidden) && (showPurchased || !i.isPurchased));
  return <section aria-label="Editable shopping list" className="mb-10">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Your shopping list</h2><button disabled={loading} className="text-sm font-semibold text-sky-700 disabled:opacity-50" onClick={() => void load().catch(() => {})}>Refresh items</button></div>
    <p className="mb-4 text-sm text-slate-500">{visible.length} visible of {items.length} loaded items. Each product appears once. Save changes to apply your edits.</p>
    <div className="mb-4 flex flex-wrap gap-5 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={showPurchased} onChange={e => setShowPurchased(e.target.checked)} />Show purchased</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />Show hidden</label>
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-amber-800">{error} Use Refresh items to try again.</p>}
    <div className="space-y-4">{items.map(item => <ShoppingListItemCard key={item.id} item={item} hidden={!visible.includes(item)} save={save} reload={id => load(null, id)} />)}</div>
    {loading && <p role="status" className="mt-3 text-sm text-slate-500">Loading list items…</p>}
    {!loading && !visible.length && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">{items.length || cursor ? "No matching items in the loaded pages. Change the filters or load more items." : "Your saved products will appear here after their details are found."}</p>}
    {cursor && <button disabled={loading} onClick={() => void load(cursor).catch(() => {})} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">Load more items</button>}
  </section>;
}
