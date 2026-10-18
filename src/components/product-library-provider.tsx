"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createProductLibraryStore, type ProductLibraryStore } from "@/stores/product-library-store";

const Context = createContext<ProductLibraryStore | null>(null);
export default function ProductLibraryProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createProductLibraryStore);
  useEffect(() => {
    const reset = () => store.getState().reset();
    window.addEventListener("myshoppinglist-session-changed", reset);
    return () => { window.removeEventListener("myshoppinglist-session-changed", reset); reset(); };
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useProductLibraryStore() {
  const store = useContext(Context);
  if (!store) throw new Error("ProductLibraryProvider is required.");
  return store;
}
