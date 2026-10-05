import { createStore } from "zustand/vanilla";
import { api, ApiError } from "@/lib/api-client";
import type {
  Session,
  ShoppingListHistory,
  ShoppingListSummary,
} from "@/lib/api-types";

export function createHistoryStore() {
  let generation = 0;
  let controller: AbortController | undefined;
  return createStore<{
    session: Session | null;
    lists: ShoppingListSummary[];
    detail: ShoppingListHistory | null;
    loading: boolean;
    error: string;
    forbidden: boolean;
    load: (id?: number) => Promise<void>;
    remove: (list: ShoppingListSummary) => Promise<void>;
    logout: () => Promise<void>;
    dispose: () => void;
  }>((set, get) => ({
    session: null,
    lists: [],
    detail: null,
    loading: true,
    error: "",
    forbidden: false,
    dispose: () => {
      generation++;
      controller?.abort();
    },
    load: async (id) => {
      const version = ++generation;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      set({ loading: true, error: "", detail: null });
      try {
        const session = await api<Session>("/auth/me", { signal });
        if (version !== generation) return;
        set({
          session,
          lists: [],
          forbidden: !session.account.isPaid || session.account.isTrial,
        });
        if (!session.account.isPaid || session.account.isTrial) return;
        const lists = await api<ShoppingListSummary[]>(
          "/shopping-lists/history",
          { signal },
        );
        const detail =
          id == null
            ? null
            : await api<ShoppingListHistory>(`/shopping-lists/${id}/history`, {
                signal,
              });
        if (version === generation) set({ lists, detail, forbidden: false });
      } catch (error) {
        if (version !== generation) return;
        set({
          lists: [],
          detail: null,
          error:
            error instanceof Error ? error.message : "Could not load history.",
          ...(error instanceof ApiError && error.status === 401
            ? { session: null }
            : {}),
          forbidden: error instanceof ApiError && error.status === 403,
        });
      } finally {
        if (version === generation) set({ loading: false });
      }
    },
    remove: async (list) => {
      if (get().loading) return;
      const version = ++generation;
      controller?.abort();
      set({ loading: true, error: "" });
      try {
        await api<void>(`/shopping-lists/${list.id}`, {
          method: "DELETE",
          body: JSON.stringify({ expectedUpdatedDate: list.updatedDate }),
        });
        if (version === generation) await get().load();
      } catch (error) {
        if (version === generation)
          set({
            error:
              error instanceof Error
                ? error.message
                : "Could not delete this list.",
          });
      } finally {
        if (version === generation) set({ loading: false });
      }
    },
    logout: async () => {
      if (get().loading) return;
      generation++;
      controller?.abort();
      set({ loading: true, error: "", lists: [], detail: null });
      try {
        await api<void>("/auth/logout", { method: "POST" });
        set({ session: null });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Could not sign out.",
        });
      } finally {
        set({ loading: false });
      }
    },
  }));
}
