import { createStore } from "zustand/vanilla";
import { api, ApiError } from "@/lib/api-client";
import type { InStoreDetail, InStoreItem, InStoreList, ListItem, Session } from "@/lib/api-types";

export function itemGroup(row: InStoreItem, shopId: number | null) {
  const match = row.prices.find(p => p.shopId === shopId);
  if (shopId !== null && (!match || match.status === "Out of stock")) return 5;
  const selected = match?.price;
  const others = row.prices.filter(p => p.shopId !== shopId && p.price !== null).map(p => p.price!);
  if (selected == null) return 4;
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
    session: Session | null; authBusy: boolean;
    accountReady: (session: Session) => void; setAuthBusy: (busy: boolean) => void; logout: () => Promise<void>;
    load: (listId?: number | null) => Promise<void>; selectShop: (id: number | null) => void;
    togglePurchasedVisibility: () => void; purchase: (row: InStoreItem) => Promise<void>; dispose: () => void;
  }>((set, get) => ({
    lists: [], detail: null, selectedList: null, shopId: null, showPurchased: false, loading: true, saving: false, error: "", unauthorized: false,
    session: null, authBusy: false,
    setAuthBusy: authBusy => { if (authBusy) { generation++; controller?.abort(); } set({ authBusy, ...(authBusy ? { loading: false } : {}) }); },
    accountReady: session => {
      generation++; controller?.abort();
      set({ session, lists: [], detail: null, selectedList: null, shopId: null, showPurchased: false, saving: false, authBusy: false, unauthorized: false, error: "" });
      void get().load(null);
    },
    logout: async () => {
      if (get().saving || get().authBusy) return;
      generation++; controller?.abort(); set({ authBusy: true, loading: false, error: "" });
      try {
        await api<void>("/auth/logout", { method: "POST" });
        set({ session: null, lists: [], detail: null, selectedList: null, shopId: null, showPurchased: false, unauthorized: true });
      } catch (e) { set({ error: e instanceof Error ? e.message : "Could not sign out." }); }
      finally { set({ authBusy: false }); }
    },
    selectShop: shopId => set({ shopId }),
    togglePurchasedVisibility: () => set(s => ({ showPurchased: !s.showPurchased })),
    dispose: () => { generation++; controller?.abort(); },
    load: async (listId = get().selectedList) => {
      if (get().saving || get().authBusy) return;
      const version = ++generation;
      controller?.abort(); controller = new AbortController();
      set({ loading: true, error: "", selectedList: listId, ...(listId !== get().selectedList ? { detail: null } : {}) });
      try {
        const session = await api<Session>("/auth/me", { signal: controller.signal });
        if (version !== generation) return;
        if (get().session && session.account.id !== get().session!.account.id) {
          set({ session, lists: [], detail: null, selectedList: null, shopId: null, showPurchased: false });
          await get().load(null); return;
        }
        set({ session });
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
          ...(unauthorized ? { session: null, lists: [], detail: null, selectedList: null, shopId: null } : {}) });
      } finally { if (version === generation) set({ loading: false }); }
    },
    purchase: async row => {
      if (get().saving || get().loading || get().authBusy) return;
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
          ...(unauthorized ? { session: null, lists: [], detail: null, selectedList: null, shopId: null } : {}) });
      } finally { if (version === generation) set({ saving: false }); }
    },
  }));
}
