"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createShoppingStore, type ShoppingState, type ShoppingStore } from "@/stores/shopping-store";

const ShoppingStoreContext = createContext<ShoppingStore | null>(null);

export default function ShoppingStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createShoppingStore);
  return <ShoppingStoreContext.Provider value={store}>{children}</ShoppingStoreContext.Provider>;
}

export function useShoppingStoreApi() {
  const store = useContext(ShoppingStoreContext);
  if (!store) throw new Error("ShoppingStoreProvider is required.");
  return store;
}

export function useShoppingStore<T>(selector: (state: ShoppingState) => T): T {
  return useStore(useShoppingStoreApi(), selector);
}
