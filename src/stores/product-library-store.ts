import { createStore } from "zustand/vanilla";
import { api, ApiError } from "@/lib/api-client";
import type { ProductPreference } from "@/lib/api-types";

type Entry = {
  value?: ProductPreference;
  loading: boolean;
  saving: boolean;
  error: string;
  notice: string;
  needsAccount?: boolean;
};
type State = {
  accountId: number | null;
  entries: Record<number, Entry>;
  revision: number;
  activate: (accountId: number) => void;
  reset: () => void;
  ensure: (accountId: number, productId: number) => void;
  seed: (accountId: number, items: ProductPreference[]) => void;
  toggle: (accountId: number, productId: number, kind: "favorite" | "essential") => Promise<void>;
};
export function createProductLibraryStore() {
  let generation = 0;
  let controller = new AbortController();
  let queued = new Set<number>();
  let scheduled = false;
  return createStore<State>((set, get) => {
    const patch = (id: number, change: Partial<Entry>) => set((state) => ({
      entries: { ...state.entries, [id]: { ...state.entries[id], ...change } },
    }));
    const flush = async () => {
      scheduled = false;
      const ids = [...queued].slice(0, 50);
      ids.forEach((id) => queued.delete(id));
      const owner = get().accountId;
      if (!ids.length || owner === null) return;
      const version = generation;
      const signal = controller.signal;
      try {
        const values = await api<ProductPreference[]>(`/account/products/preferences?productIds=${ids.join(",")}&expectedAccountId=${owner}`, { signal });
        if (version !== generation || owner !== get().accountId) return;
        ids.forEach((id) => {
          if (get().entries[id]?.saving || get().entries[id]?.notice) return;
          const value = values.find((item) => item.productId === id);
          patch(id, { value, loading: false, error: value ? "" : "Product settings are unavailable. Reload your list." });
        });
      } catch (error) {
        if (signal.aborted || version !== generation) return;
        ids.forEach((id) => patch(id, {
          loading: false,
          error: error instanceof Error ? error.message : "Could not load product settings.",
          needsAccount: error instanceof ApiError && error.status === 403,
        }));
      } finally {
        if (version === generation && queued.size && !scheduled) {
          scheduled = true;
          queueMicrotask(() => void flush());
        }
      }
    };
    return {
      accountId: null, entries: {}, revision: 0,
      reset: () => {
        generation++;
        controller.abort(); controller = new AbortController();
        queued = new Set(); scheduled = false;
        set({ accountId: null, entries: {}, revision: 0 });
      },
      activate: (accountId) => {
        if (get().accountId === accountId) return;
        get().reset(); set({ accountId });
      },
      seed: (accountId, items) => {
        if (get().accountId !== accountId) return;
        for (const value of items) {
          const existing = get().entries[value.productId];
          if (!existing?.saving) patch(value.productId, { value, loading: false, saving: false, error: "", notice: "" });
        }
      },
      ensure: (accountId, productId) => {
        if (get().accountId !== accountId || get().entries[productId]?.loading || get().entries[productId]?.value) return;
        patch(productId, { loading: true, saving: false, error: "", notice: "" });
        queued.add(productId);
        if (!scheduled) { scheduled = true; queueMicrotask(() => void flush()); }
      },
      toggle: async (accountId, productId, kind) => {
        const entry = get().entries[productId];
        if (get().accountId !== accountId || !entry?.value || entry.saving || entry.loading) return;
        const selected = !(kind === "favorite" ? entry.value.isFavorite : entry.value.isEssential);
        const version = generation;
        const signal = controller.signal;
        patch(productId, { saving: true, error: "", notice: "" });
        try {
          const value = await api<ProductPreference>(`/account/products/${productId}/preferences`, {
            method: "PUT", signal,
            body: JSON.stringify({ expectedAccountId: accountId, kind, selected }),
          });
          if (signal.aborted || generation !== version || get().accountId !== accountId) return;
          patch(productId, { value, saving: false, notice: `${selected ? "Added to" : "Removed from"} ${kind === "favorite" ? "Favorites" : "Essentials"}.` });
          set((state) => ({ revision: state.revision + 1 }));
        } catch (error) {
          if (!signal.aborted && generation === version) patch(productId, { saving: false, error: error instanceof Error ? error.message : "Could not save. Try again." });
        }
      },
    };
  });
}
export type ProductLibraryStore = ReturnType<typeof createProductLibraryStore>;
