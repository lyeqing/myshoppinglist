import { createStore } from "zustand/vanilla";
import type {
  Job,
  ListItem,
  Session,
  ShoppingListPlan,
} from "../lib/api-types";

type Update<T> = T | ((previous: T) => T);
const resolve = <T>(value: Update<T>, previous: T): T =>
  typeof value === "function" ? (value as (previous: T) => T)(previous) : value;

const emptyList = () => ({
  jobs: {} as Record<number, Job>,
  errors: {} as Record<number, string>,
  cursor: null as number | null,
  loading: false,
  loadError: "",
  items: [] as ListItem[],
  itemCursor: null as number | null,
  itemsLoading: true,
  itemsError: "",
  plan: null as ShoppingListPlan | null,
});

export interface ShoppingState {
  session: Session | null;
  booting: boolean;
  restoreError: string;
  jobs: Record<number, Job>;
  errors: Record<number, string>;
  cursor: number | null;
  loading: boolean;
  loadError: string;
  items: ListItem[];
  plan: ShoppingListPlan | null;
  itemCursor: number | null;
  itemsLoading: boolean;
  itemsError: string;
  actions: {
    setSession: (session: Session) => void;
    clearSession: () => void;
    setBooting: (booting: boolean) => void;
    setRestoreError: (restoreError: string) => void;
    setJobs: (value: Update<Record<number, Job>>) => void;
    setErrors: (value: Update<Record<number, string>>) => void;
    setCursor: (cursor: number | null) => void;
    setLoading: (loading: boolean) => void;
    setLoadError: (loadError: string) => void;
    setItems: (items: ListItem[]) => void;
    setPlan: (plan: ShoppingListPlan | null) => void;
    setItemCursor: (itemCursor: number | null) => void;
    setItemsLoading: (itemsLoading: boolean) => void;
    setItemsError: (itemsError: string) => void;
  };
}

// Each provider owns its store; account/list changes clear cached data atomically.
export const createShoppingStore = () =>
  createStore<ShoppingState>()((set) => ({
    session: null,
    booting: true,
    restoreError: "",
    ...emptyList(),
    actions: {
      setSession: (session) =>
        set((previous) => ({
          ...(previous.session?.account.id !== session.account.id ||
          previous.session?.shoppingListId !== session.shoppingListId
            ? emptyList()
            : {}),
          session,
          restoreError: "",
        })),
      clearSession: () =>
        set({
          ...emptyList(),
          session: null,
          booting: false,
          restoreError: "",
        }),
      setBooting: (booting) => set({ booting }),
      setRestoreError: (restoreError) => set({ restoreError }),
      setJobs: (value) =>
        set((state) => ({ jobs: resolve(value, state.jobs) })),
      setErrors: (value) =>
        set((state) => ({ errors: resolve(value, state.errors) })),
      setCursor: (cursor) => set({ cursor }),
      setLoading: (loading) => set({ loading }),
      setLoadError: (loadError) => set({ loadError }),
      setItems: (items) => set({ items }),
      setPlan: (plan) =>
        set({ plan, items: plan?.items.map((row) => row.item) ?? [] }),
      setItemCursor: (itemCursor) => set({ itemCursor }),
      setItemsLoading: (itemsLoading) => set({ itemsLoading }),
      setItemsError: (itemsError) => set({ itemsError }),
    },
  }));
export type ShoppingStore = ReturnType<typeof createShoppingStore>;
