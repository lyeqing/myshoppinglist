"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppHeader from "./app-header";
import { useStore } from "zustand";
import { api, ApiError } from "@/lib/api-client";
import type { ProductLibraryPage, Session, ShoppingListManagement } from "@/lib/api-types";
import ProductBadges from "./product-badges";
import { useProductLibraryStore } from "./product-library-provider";

type View = "history" | "favorites" | "essentials";
const tabs = [
  { view: "history", href: "/products/history", label: "Product history" },
  { view: "favorites", href: "/favorites", label: "Favorites" },
  { view: "essentials", href: "/essentials", label: "Essentials" },
] as const;
const button = "min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50";

export default function ProductLibraryApp({ view }: { view: View }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const store = useProductLibraryStore();
  useEffect(() => {
    let controller = new AbortController();
    const load = async () => {
      controller.abort(); controller = new AbortController();
      const signal = controller.signal;
      setSession(null); setLoading(true); setError("");
      try {
        const current = await api<Session>("/auth/me", { signal });
        if (!signal.aborted) { store.getState().activate(current.account.id); setSession(current); }
      } catch (e) {
        if (!signal.aborted) setError(e instanceof ApiError && e.status === 401 ? "Sign in to view your products." : e instanceof Error ? e.message : "Could not load your account.");
      } finally { if (!signal.aborted) setLoading(false); }
    };
    const changed = () => { store.getState().reset(); void load(); };
    void load();
    window.addEventListener("myshoppinglist-session-changed", changed);
    return () => { controller.abort(); window.removeEventListener("myshoppinglist-session-changed", changed); };
  }, [store, retry]);
  const title = tabs.find((tab) => tab.view === view)!.label;
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <AppHeader session={session} active="products" loading={loading} />
    <main className="mx-auto max-w-5xl px-5 py-8">
      <nav aria-label="Product pages" className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tab) => <Link key={tab.view} href={tab.href} aria-current={tab.view === view ? "page" : undefined}
          className={`${button} ${tab.view === view ? "border-sky-700 bg-sky-50 text-sky-900" : "text-slate-600"}`}>{tab.label}</Link>)}
      </nav>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{view === "essentials"
        ? "Your regular products, automatically added to every new shopping list at quantity 1. Removing an Essential affects future lists; products already on your lists stay there."
        : view === "favorites" ? "Keep your go-to products handy. Add them to a shopping list or mark them Essential for every new list."
        : "Products you have added to your shopping lists. Filter by products marked purchased. This is not a record of receipts or purchase prices."}</p>
      {loading && <p role="status" className="mt-6">Loading your account…</p>}
      {error && <div role="alert" className="mt-6 rounded-xl bg-amber-50 p-4">{error} <button type="button" className={button} onClick={() => setRetry((n) => n + 1)}>Retry</button> <Link href="/" className="underline">Sign in</Link></div>}
      {session?.account.isTrial && <p className="mt-6 rounded-xl bg-sky-50 p-4"><Link href="/" className="font-semibold underline">Create an account</Link> to keep product history and save Favorites and Essentials.</p>}
      {session && !session.account.isTrial && <Library key={`${session.account.id}-${view}`} session={session} view={view} />}
    </main>
  </div>;
}

function Library({ session, view }: { session: Session; view: View }) {
  const store = useProductLibraryStore();
  const revision = useStore(store, (state) => state.revision);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState<ProductLibraryPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [management, setManagement] = useState<ShoppingListManagement | null>(null);
  const [listId, setListId] = useState(session.shoppingListId ?? 0);
  const [adding, setAdding] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  const query = useRef(0);
  const accountId = session.account.id;
  const loadLists = useCallback(async (signal: AbortSignal) => {
    const value = await api<ShoppingListManagement>("/shopping-lists/manage", { signal });
    if (!signal.aborted) {
      setManagement(value);
      setListId((id) => value.lists.some((list) => list.id === id) ? id : value.lists[0]?.id ?? 0);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const timer = window.setTimeout(() => void loadLists(controller.signal).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load shopping lists."); }), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadLists]);
  useEffect(() => store.subscribe((state, previous) => {
    if (state.revision !== previous.revision) setOffset(0);
  }), [store]);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const version = ++query.current;
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ view, filter, search, offset: String(offset), pageSize: "24" });
        const page = await api<ProductLibraryPage>(`/account/products?${params}`, { signal });
        if (signal.aborted || query.current !== version) return;
        if (page.accountId !== accountId) throw new Error("Your account changed. Reload your products.");
        store.getState().seed(accountId, page.items.map((item) => ({ productId: item.product.id, isFavorite: item.isFavorite, isEssential: item.isEssential })));
        setData((previous) => offset > 0 && previous ? { ...page, items: [...previous.items, ...page.items.filter((item) => !previous.items.some((old) => old.product.id === item.product.id))] } : page);
      } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : "Could not load your products."); }
      finally { if (!signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [store, accountId, view, filter, search, offset, revision, reload]);
  useEffect(() => {
    const focus = () => { setOffset(0); setReload((n) => n + 1); if (lifetime.current) void loadLists(lifetime.current.signal).catch(() => {}); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [loadLists]);
  const add = async (productId: number) => {
    if (!listId || adding !== null || !lifetime.current) return;
    const signal = lifetime.current.signal;
    setAdding(productId); setNotice(""); setError("");
    try {
      const result = await api<{ itemId: number; alreadyOnList: boolean }>(`/shopping-lists/${listId}/products/${productId}`, { method: "POST", signal, body: JSON.stringify({ expectedAccountId: accountId }) });
      if (!signal.aborted) {
        const name = management?.lists.find((list) => list.id === listId)?.name ?? "your list";
        setNotice(result.alreadyOnList ? `Already on “${name}”. Its quantity and settings were kept.` : `Added to “${name}” at quantity 1.`);
        setOffset(0); setReload((n) => n + 1);
      }
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : "Could not add this product."); }
    finally { if (!signal.aborted) setAdding(null); }
  };
  const retry = () => {
    setOffset(0); setReload((n) => n + 1);
    if (lifetime.current) void loadLists(lifetime.current.signal).catch((e) => setError(e instanceof Error ? e.message : "Could not load lists."));
  };
  const date = (value: string) => new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  return <>
    <div className="mt-6 flex flex-wrap items-end gap-4">
      <label className="min-w-48 flex-1 text-sm font-medium">Search products<input type="search" maxLength={100} value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3" /></label>
      {view === "history" && <label className="text-sm font-medium">Purchase history<select value={filter} onChange={(e) => { setFilter(e.target.value); setOffset(0); }} className="mt-1 block min-h-11 rounded-xl border border-slate-300 bg-white px-3"><option value="all">All products</option><option value="purchased">Previously marked purchased</option><option value="unpurchased">Not marked purchased</option></select></label>}
      <label className="text-sm font-medium">Add to shopping list<select value={listId} disabled={adding !== null || !management?.lists.length} onChange={(e) => { setListId(Number(e.target.value)); setNotice(""); }} className="mt-1 block min-h-11 max-w-full rounded-xl border border-slate-300 bg-white px-3">{!management?.lists.length && <option value={0}>No active lists</option>}{management?.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
    </div>
    {management?.lists.length === 0 && <p className="mt-3 text-sm"><Link href="/" className="font-semibold text-sky-700 underline">Create a shopping list</Link> to add saved products.</p>}
    {notice && <p role="status" className="mt-4 text-sm text-sky-800">{notice}</p>}
    {revision > 0 && <p role="status" className="mt-2 text-sm text-sky-800">Saved product settings updated.</p>}
    {error && <div role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm">{error} <button type="button" className={button} onClick={retry}>Retry products</button></div>}
    {(loading || !data && !error) && <p role="status" className="mt-4 text-sm text-slate-500">Loading products…</p>}
    {data && <p className="mt-4 text-sm text-slate-500">{data.total} {data.total === 1 ? "product" : "products"}</p>}
    {data && !data.items.length && !loading && <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">{search || filter !== "all" ? "No products match these filters. Try another search or show all products." : view === "history" ? "Products will appear here after you add them to a shopping list." : view === "favorites" ? "No Favorites yet. Click the Favorite badge on a product to save it here." : "No Essentials yet. Click the Essential badge on a product to include it in every new list."}</p>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {data?.items.map((item) => <article key={item.product.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="wrap-break-word font-semibold">{item.product.name}</h2>
        <p className="mt-1 text-sm text-slate-500">{[item.product.brand, item.product.packSize != null ? `${item.product.packQuantity && item.product.packQuantity > 1 ? `${item.product.packQuantity} × ` : ""}${item.product.packSize} ${item.product.packUnit ?? ""}` : null].filter(Boolean).join(" · ")}</p>
        {item.lastAddedDate && <p className="mt-2 text-xs text-slate-500">Last added {date(item.lastAddedDate)} · Added {item.timesAdded} {item.timesAdded === 1 ? "time" : "times"}</p>}
        {item.lastPurchasedDate && <p className="mt-1 text-xs text-slate-500">Last marked purchased {date(item.lastPurchasedDate)}</p>}
        <ProductBadges accountId={accountId} productId={item.product.id} name={item.product.name} />
        <button type="button" className={`${button} mt-4 text-sky-800`} disabled={!listId || adding !== null} onClick={() => void add(item.product.id)}>{adding === item.product.id ? "Adding…" : "Add to list"}</button>
      </article>)}
    </div>
    {data?.nextOffset != null && <button type="button" className={`${button} mt-6`} disabled={loading} onClick={() => setOffset(data.nextOffset!)}>Load more products</button>}
  </>;
}
