"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, ApiError } from "@/lib/api-client";
import {
  isActive,
  type ListItem,
  type ListItemUpdate,
  type ShoppingListPlan,
  type ItemComparison,
} from "@/lib/api-types";
import ShoppingListItemCard from "./shopping-list-item-card";
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
  const { plan, jobs, loading, error } = useShoppingStore(
    useShallow((state) => ({
      plan: state.plan,
      jobs: state.jobs,
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
  const load = useCallback(async (): Promise<ShoppingListPlan | null> => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || mutation.current) return null;
    const version = ++readVersion.current;
    const owner = store.getState().session?.account.id;
    const current = () =>
      !signal.aborted &&
      version === readVersion.current &&
      store.getState().session?.account.id === owner &&
      store.getState().session?.shoppingListId === listId;
    setLoading(true);
    setError("");
    try {
      const result = await api<ShoppingListPlan>(
        `/shopping-lists/${listId}/plan`,
        { signal },
      );
      if (!current()) throw new DOMException("Read superseded", "AbortError");
      setPlan(result);
      return result;
    } catch (e) {
      if (current()) handle(e);
      throw e;
    } finally {
      if (current()) setLoading(false);
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
    const controller = new AbortController();
    void api(`/shopping-lists/${listId}/refresh-prices`, {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    })
      .then(() => {
        if (!controller.signal.aborted) return load();
      })
      .catch((e) => {
        if (!controller.signal.aborted) handle(e);
      });
    return () => controller.abort();
  }, [listId, load, handle]);
  const refreshing =
    plan?.items.some(
      (row) =>
        row.comparison?.status === "Checking" ||
        row.prices.some(
          (price) =>
            price.refreshStatus === "Waiting" ||
            price.refreshStatus === "Updating",
        ),
    ) ?? false;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") await load().catch(() => {});
      if (!stopped) timer = setTimeout(poll, refreshing ? 3000 : 30000);
    };
    // Idle checks discover refreshes queued by the server after this list was opened.
    timer = setTimeout(poll, refreshing ? 3000 : 30000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load, refreshing]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load().catch(() => {});
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

  async function retryComparison(id: number) {
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
    try {
      const comparison = await api<ItemComparison>(
        `/shopping-lists/${listId}/items/${id}/retry-comparison`,
        {
          method: "POST",
          body: "{}",
          signal,
        },
      );
      if (!current()) throw new DOMException("Aborted", "AbortError");
      const latest = store.getState().plan;
      if (latest)
        setPlan({
          ...latest,
          items: latest.items.map((row) =>
            row.item.id === id ? { ...row, comparison } : row,
          ),
        });
    } catch (e) {
      if (current() && e instanceof ApiError && e.status === 401)
        onExpired(e.message);
      throw e;
    } finally {
      mutation.current = false;
      if (current()) {
        setSaving(false);
        void load().catch(() => {});
      }
    }
  }

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
        <button
          disabled={loading || saving}
          className="text-sm font-semibold text-sky-700 disabled:opacity-50"
          onClick={() => void load().catch(() => {})}
        >
          Refresh items
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-amber-800">
          {error} Use Refresh items to try again.
        </p>
      )}
      {plan && !saving && !error && <ShoppingListCostSummary plan={plan} />}
      <div className="space-y-4">
        {plan?.items.map((row) => (
          <ShoppingListItemCard
            key={row.item.id}
            row={row}
            disabled={saving}
            checking={Object.values(jobs).some(
              (job) =>
                job.shoppingListProductId === row.item.id && isActive(job),
            )}
            save={save}
            remove={remove}
            retryComparison={retryComparison}
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
          Your saved products will appear here after their details are found.
        </p>
      )}
    </section>
  );
}
