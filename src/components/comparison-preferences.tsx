"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createShoppingPreferencesStore } from "@/stores/shopping-preferences-store";

type Props = {
  accountId?: number;
  disabled?: boolean;
  onChanged: () => Promise<unknown>;
};
const button =
  "min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50";
export default function ComparisonPreferences(props: Props) {
  return props.accountId ? (
    <Controls key={props.accountId} {...props} accountId={props.accountId} />
  ) : null;
}
function Controls({
  accountId,
  disabled,
  onChanged,
}: Props & { accountId: number }) {
  const [store] = useState(createShoppingPreferencesStore);
  const state = useStore(store);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const opened = useRef(false);
  const epoch = useRef(0),
    operation = useRef(false);
  useEffect(() => {
    const invalidate = () => {
      epoch.current++;
      operation.current = false;
    };
    const load = () => {
      invalidate();
      setRefreshing(false);
      setRefreshError("");
      store.getState().dispose();
      if (opened.current) void store.getState().load();
    };
    load();
    window.addEventListener("myshoppinglist-session-changed", load);
    return () => {
      invalidate();
      store.getState().dispose();
      window.removeEventListener("myshoppinglist-session-changed", load);
    };
  }, [store]);
  const owner = state.session?.account.id;
  useEffect(() => {
    if (owner !== undefined && owner !== accountId)
      window.dispatchEvent(new Event("myshoppinglist-session-changed"));
  }, [owner, accountId]);
  const sameAccount = owner === accountId;
  const draft = sameAccount ? state.draft : null;
  const changed =
    !!draft &&
    !!state.preferences &&
    (draft.includeDifferentPackSizes !==
      state.preferences.includeDifferentPackSizes ||
      draft.includeDifferentBrands !==
        state.preferences.includeDifferentBrands);
  const locked =
    disabled ||
    state.loading ||
    state.saving ||
    state.conflict ||
    refreshing ||
    !!refreshError ||
    !sameAccount;
  async function refresh(version: number) {
    setRefreshing(true);
    setRefreshError("");
    try {
      await onChanged();
    } catch {
      if (epoch.current === version)
        setRefreshError(
          "Options were saved, but comparisons could not be reloaded. Retry refreshing comparisons.",
        );
    } finally {
      if (epoch.current === version) setRefreshing(false);
    }
  }
  async function save() {
    if (operation.current || locked || !changed) return;
    operation.current = true;
    const version = epoch.current;
    try {
      await store.getState().save();
      const saved = store.getState();
      if (
        epoch.current === version &&
        saved.notice &&
        saved.preferences?.accountId === accountId &&
        !saved.error
      )
        await refresh(version);
    } finally {
      if (epoch.current === version) operation.current = false;
    }
  }
  return (
    <section
      aria-label="Comparison options"
      className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700"
    >
      <details
        onToggle={(event) => {
          if (event.currentTarget.open && !opened.current) {
            opened.current = true;
            void store.getState().load();
          }
        }}
      >
        <summary className="min-h-11 cursor-pointer py-3 font-semibold text-slate-900">
          Comparison options
        </summary>
        <div className="space-y-3 pt-2">
          <p>
            Choose which saved alternatives to show. These settings apply to
            your account and do not change your list or basket totals.
            Comparisons use saved observations. To compare another size or brand,
            save it with the Chrome extension first; these options do not collect prices.
          </p>
          {state.loading && <p role="status">Loading comparison options…</p>}
          {state.error && (
            <p role="alert" className="text-amber-900">
              {state.error}
            </p>
          )}
          {state.unauthorized ? (
            <p>
              <Link href="/" className="font-semibold text-sky-700 underline">
                Sign in to change comparison options
              </Link>
            </p>
          ) : (
            <>
              {draft && (
                <fieldset
                  disabled={locked}
                  className="space-y-3 disabled:opacity-60"
                >
                  <legend className="sr-only">
                    Saved alternative preferences
                  </legend>
                  <label className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-sky-700"
                      checked={draft.includeDifferentPackSizes}
                      onChange={(event) =>
                        store
                          .getState()
                          .setDifferentPackSizes(event.target.checked)
                      }
                    />
                    Show different package sizes
                  </label>
                  <label className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-sky-700"
                      checked={draft.includeDifferentBrands}
                      onChange={(event) =>
                        store
                          .getState()
                          .setDifferentBrands(event.target.checked)
                      }
                    />
                    Show alternative brands
                  </label>
                  <p className="text-xs text-slate-500">
                    Other sizes are the same product. Alternative brands are
                    reviewed substitutes; taste, ingredients and quality may
                    differ. Results appear when qualifying saved prices exist.
                  </p>
                  <button
                    type="button"
                    className={`${button} bg-sky-700 text-white`}
                    disabled={!changed}
                    onClick={() => void save()}
                  >
                    Save comparison options
                  </button>
                </fieldset>
              )}
              {state.error && !state.saving && (
                <button
                  type="button"
                  className={button}
                  disabled={disabled || refreshing}
                  onClick={() => {
                    setRefreshError("");
                    void store.getState().load();
                  }}
                >
                  {draft || state.conflict
                    ? "Reload comparison options"
                    : "Retry loading comparison options"}
                </button>
              )}
            </>
          )}
          {state.saving && <p role="status">Saving comparison options…</p>}
          {refreshing && (
            <p role="status">Comparison options saved. Updating comparisons…</p>
          )}
          {state.notice && !refreshing && !refreshError && (
            <p role="status" className="text-emerald-800">
              Comparison options saved.
            </p>
          )}
          {refreshError && (
            <>
              <p role="alert" className="text-amber-900">
                {refreshError}
              </p>
              <button
                type="button"
                className={button}
                disabled={disabled || refreshing}
                onClick={() => {
                  if (!operation.current) {
                    operation.current = true;
                    const version = epoch.current;
                    void refresh(version).finally(() => {
                      if (epoch.current === version) operation.current = false;
                    });
                  }
                }}
              >
                Retry refreshing comparisons
              </button>
            </>
          )}
          <Link
            href="/settings"
            className="inline-block min-h-11 py-3 font-semibold text-sky-700 underline"
          >
            Manage supermarkets and branches
          </Link>
        </div>
      </details>
    </section>
  );
}
