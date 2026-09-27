import { createStore } from "zustand/vanilla";
import { api, ApiError } from "@/lib/api-client";
import type { InStoreDetail, InStoreItem, InStoreList, ListItem } from "@/lib/api-types";

export function itemGroup(row: InStoreItem, shopId: number | null) {
  const selected = row.prices.find(p => p.shopId === shopId)?.price;
  const others = row.prices.filter(p => p.shopId !== shopId && p.price !== null).map(p => p.price!);
  if (selected == null) return others.length ? 3 : 4;
  if (!others.length) return 1;
  const bestOther = Math.min(...others);
  return selected < bestOther ? 0 : selected === bestOther ? 2 : 3;
}

export function createInStoreStore() {
  let generation = 0;
  let controller: AbortController | undefined;
  return createStore<{
    lists: InStoreList[]; detail: InStoreDetail | null; selectedList: number | null; shopId: number | null;
    showPurchased: boolean; loading: boolean; saving: boolean; error: string; unauthorized: boolean;
    load: (listId?: number | null) => Promise<void>; selectShop: (id: number | null) => void;
    togglePurchasedVisibility: () => void; purchase: (row: InStoreItem) => Promise<void>; dispose: () => void;
  }>((set, get) => ({
    lists: [], detail: null, selectedList: null, shopId: null, showPurchased: false, loading: true, saving: false, error: "", unauthorized: false,
    selectShop: shopId => set({ shopId }),
    togglePurchasedVisibility: () => set(s => ({ showPurchased: !s.showPurchased })),
    dispose: () => { generation++; controller?.abort(); },
    load: async (listId = get().selectedList) => {
      if (get().saving) return;
      const version = ++generation;
      controller?.abort(); controller = new AbortController();
      set({ loading: true, error: "", selectedList: listId, ...(listId !== get().selectedList ? { detail: null } : {}) });
      try {
        const [lists, detail] = await Promise.all([
          api<InStoreList[]>("/shopping-lists", { signal: controller.signal }),
          listId === null ? Promise.resolve(null) : api<InStoreDetail>(`/shopping-lists/${listId}/in-store`, { signal: controller.signal }),
        ]);
        if (version !== generation) return;
        const shops = detail?.retailers ?? lists.flatMap(l => l.retailers);
        set({ lists, detail, unauthorized: false, shopId: shops.some(s => s.id === get().shopId) ? get().shopId : null });
      } catch (e) {
        if (version !== generation) return;
        const unauthorized = e instanceof ApiError && e.status === 401;
        set({ error: e instanceof Error ? e.message : "Could not load your lists.", unauthorized,
          ...(unauthorized ? { lists: [], detail: null } : {}) });
      } finally { if (version === generation) set({ loading: false }); }
    },
    purchase: async row => {
      if (get().saving || get().loading) return;
      const version = generation;
      const item = row.item;
      set({ saving: true, error: "" });
      try {
        await api<ListItem>(`/shopping-lists/${item.shoppingListId}/items/${item.id}`, { method: "PUT", body: JSON.stringify({
          quantity: item.quantity, notes: item.notes, isPurchased: !item.isPurchased, isHidden: item.isHidden, expectedUpdatedDate: item.updatedDate,
        }) });
        if (version !== generation) return;
        set({ saving: false });
        await get().load();
      } catch (e) {
        if (version !== generation) return;
        const unauthorized = e instanceof ApiError && e.status === 401;
        set({ error: e instanceof Error ? e.message : "Could not save purchase.", unauthorized,
          ...(unauthorized ? { lists: [], detail: null } : {}) });
      } finally { if (version === generation) set({ saving: false }); }
    },
  }));
}
