"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, ApiError } from "@/lib/api-client";
import {
  isActive,
  type ListItem,
  type ListItemUpdate,
  type ShoppingListPlan,
} from "@/lib/api-types";
import ComparisonStoreContextPanel from "./comparison-store-context";
import ExtensionRefreshControl from "./extension-refresh-control";
import ComparisonPreferences from "./comparison-preferences";
import ShoppingListItemCard from "./shopping-list-item-card";
import PackDiscoveryControls from "./pack-discovery-controls";
import ShoppingListCostSummary from "./shopping-list-cost-summary";
import {
  useShoppingStore,
  useShoppingStoreApi,
} from "./shopping-store-provider";

export default function ShoppingListItems({
  listId,
  refreshKey,
  onExpired,
}: {
  listId: number;
  refreshKey: string;
  onExpired: (message: string) => void;
}) {
  const store = useShoppingStoreApi();
  const { plan, loading, error } = useShoppingStore(
    useShallow((state) => ({
      plan: state.plan,
      loading: state.itemsLoading,
      error: state.itemsError,
    })),
  );
  const {
    setPlan,
    setItemsLoading: setLoading,
    setItemsError: setError,
    setJobs,
  } = useShoppingStore((state) => state.actions);
  const [saving, setSaving] = useState(false);
  const mutation = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const readVersion = useRef(0);
  const handle = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) onExpired(e.message);
      else if (!(e instanceof Error && e.name === "AbortError"))
        setError(e instanceof Error ? e.message : "Unable to load your list.");
    },
    [onExpired, setError],
  );
  const load = useCallback(async (
    options?: { background?: boolean },
  ): Promise<ShoppingListPlan | null> => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || mutation.current) return null;
    // Background checks must not dim controls or interrupt an explicit reload.
    if (options?.background && store.getState().itemsLoading) return null;
    const showLoading = !options?.background || !store.getState().plan;
    const version = ++readVersion.current;
    const owner = store.getState().session?.account.id;
    const current = () =>
      !signal.aborted &&
      version === readVersion.current &&
      store.getState().session?.account.id === owner &&
      store.getState().session?.shoppingListId === listId;
    if (showLoading) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await api<ShoppingListPlan>(
        `/shopping-lists/${listId}/plan`,
        { signal },
      );
      if (!current()) throw new DOMException("Read superseded", "AbortError");
      setError("");
      setPlan(result);
      return result;
    } catch (e) {
      if (current()) handle(e);
      throw e;
    } finally {
      if (current() && showLoading) setLoading(false);
    }
  }, [listId, handle, store, setPlan, setLoading, setError]);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    void load().catch(() => {});
  }, [load, refreshKey]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible")
        void load({ background: true }).catch(() => {});
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);

  async function change<T>(
    id: number,
    method: "PUT" | "DELETE",
    body: ListItemUpdate | { expectedUpdatedDate: string },
  ) {
    if (mutation.current)
      throw new Error("Please wait for the current change to finish.");
    const signal = lifetime.current!.signal;
    const owner = store.getState().session?.account.id;
    const current = () =>
      !signal.aborted &&
      store.getState().session?.account.id === owner &&
      store.getState().session?.shoppingListId === listId;
    mutation.current = true;
    setSaving(true);
    readVersion.current++;
    setLoading(false);
    try {
      const result = await api<T>(`/shopping-lists/${listId}/items/${id}`, {
        method,
        body: JSON.stringify(body),
        signal,
      });
      if (!current()) throw new DOMException("Aborted", "AbortError");
      readVersion.current++;
      const oldPlan = store.getState().plan;
      if (oldPlan)
        setPlan({
          ...oldPlan,
          items:
            method === "DELETE"
              ? oldPlan.items.filter((row) => row.item.id !== id)
              : oldPlan.items.map((row) =>
                  row.item.id === id
                    ? { ...row, item: result as ListItem }
                    : row,
                ),
        });
      if (method === "DELETE") {
        setJobs((previous) =>
          Object.fromEntries(
            Object.entries(previous).map(([key, job]) => [
              key,
              job.shoppingListProductId === id
                ? {
                    ...job,
                    shoppingListProductId: null,
                    ...(isActive(job)
                      ? {
                          status: "Cancelled" as const,
                          errorCode: "list_item_removed",
                        }
                      : {}),
                  }
                : job,
            ]),
          ),
        );
      }
      mutation.current = false;
      // Keep cards mounted to preserve note drafts. Hide stale totals while refreshing.
      await load().catch(() => {});
      return result;
    } catch (e) {
      if (current() && e instanceof ApiError && e.status === 401)
        onExpired(e.message);
      throw e;
    } finally {
      mutation.current = false;
      if (current()) setSaving(false);
    }
  }
  const save = (id: number, edit: ListItemUpdate) =>
    change<ListItem>(id, "PUT", edit);
  const remove = (id: number, expectedUpdatedDate: string) =>
    change<void>(id, "DELETE", { expectedUpdatedDate });

  return (
    <section aria-label="Editable shopping list" className="mb-10">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Your shopping list</h2>
          {plan && (
            <p className="mt-1 text-sm text-slate-500">
              {plan.name} · {plan.items.length}{" "}
              {plan.items.length === 1 ? "item" : "items"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-4">
          <ExtensionRefreshControl key={`${store.getState().session?.account.id}-${listId}`}
            accountId={store.getState().session?.account.id} listId={listId}
            disabled={loading || saving} onReload={load} />
        </div>
      </div>
      {plan?.storeContext && (
        <ComparisonStoreContextPanel context={plan.storeContext} />
      )}
      {plan && (
        <ComparisonPreferences
          key={`${store.getState().session?.account.id}-${listId}`}
          accountId={store.getState().session?.account.id}
          disabled={saving || loading}
          onChanged={async () => {
            if (!(await load()))
              throw new Error("Comparison reload is unavailable.");
          }}
        />
      )}
      {error && (
        <p role="alert" className="mb-3 text-sm text-amber-800">
          {error} Use Refresh items to try again.
        </p>
      )}
      {plan?.items.some((r) => !r.item.isPurchased && !r.item.isHidden) && (
        <PackDiscoveryControls
          accountId={store.getState().session?.account.id}
          listId={listId}
          disabled={saving}
          onDiscovered={load}
        />
      )}
      {plan && !saving && !error && <ShoppingListCostSummary plan={plan} />}
      <div className="space-y-4">
        {plan?.items.map((row) => (
          <ShoppingListItemCard
            key={row.item.id}
            row={row}
            accountId={store.getState().session?.account.id}
            onDiscovered={load}
            disabled={saving}
            save={save}
            remove={remove}
            reload={async (id) =>
              (await load())?.items.find((row) => row.item.id === id)?.item ??
              null
            }
          />
        ))}
      </div>
      {loading && (
        <p role="status" className="mt-3 text-sm text-slate-500">
          Loading list items…
        </p>
      )}
      {!loading && plan?.items.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
          Products you save with the Chrome extension will appear here. Use Refresh items after saving.
        </p>
      )}
    </section>
  );
}
