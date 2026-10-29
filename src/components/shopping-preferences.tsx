"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppHeader from "./app-header";
import { useStore } from "zustand";
import PreferredShopBranches from "@/components/preferred-shop-branches";
import { createShoppingPreferencesStore } from "@/stores/shopping-preferences-store";

export default function ShoppingPreferences() {
  const [store] = useState(createShoppingPreferencesStore);
  const state = useStore(store);
  const { load, dispose, draft } = state;
  useEffect(() => {
    void load();
    return dispose;
  }, [load, dispose]);
  useEffect(() => {
    const changed = () => {
      dispose();
      store.setState({ session: null, preferences: null, draft: null });
      void load();
    };
    window.addEventListener("myshoppinglist-session-changed", changed);
    return () =>
      window.removeEventListener("myshoppinglist-session-changed", changed);
  }, [store, load, dispose]);
  const disabled = state.loading || state.saving;
  const selected = draft?.shops.filter((s) => s.isEnabled) ?? [];
  const hasAldiSelection = selected.some(s => draft?.availableShops.find(a => a.id === s.shopId)?.code === "aldi");
  const unsupportedOnly =
    draft?.compareOnlyPreferredShops &&
    selected.length > 0 &&
    selected.every(
      (s) =>
        !draft.availableShops.find((a) => a.id === s.shopId)
          ?.comparisonSupported,
    );
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader session={state.session} active="stores" loading={state.loading} disabled={disabled} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Choose your supermarkets for comparisons using saved price observations.
          Use Refresh items on your list to update saved prices through your
          Chrome extension. You can also save the branches you visit.
        </p>
        {state.session?.account.isTrial && (
          <p className="mt-3 text-sm text-sky-800">
            Settings are saved for this trial. Create an account before it
            expires to keep them with your list.
          </p>
        )}
        {state.loading && (
          <p role="status" className="mt-6">
            Loading your stores…
          </p>
        )}
        {state.error && (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
          >
            {state.error}
          </p>
        )}
        {state.unauthorized ? (
          <p className="mt-5">
            <Link href="/" className="font-semibold text-sky-700 underline">
              Sign in or start a trial
            </Link>{" "}
            to choose your stores.
          </p>
        ) : (
          <>
            {!state.loading && state.error && (
              <button
                type="button"
                className="mt-4 min-h-11 rounded-xl border px-4 py-2 font-semibold"
                disabled={state.saving}
                onClick={() => void load()}
              >
                {state.conflict || draft
                  ? "Reload settings"
                  : "Retry loading settings"}
              </button>
            )}
            {draft && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void state.save();
                }}
                className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7"
              >
                <fieldset
                  disabled={disabled || state.conflict}
                  className="space-y-3 disabled:opacity-60"
                >
                  <legend className="mb-3 text-lg font-semibold">
                    Preferred supermarkets
                  </legend>
                  {draft.availableShops.map((shop) => (
                    <div
                      key={shop.id}
                      className="rounded-xl border border-slate-200 p-4"
                    >
                      <label className="flex min-h-11 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 size-5 shrink-0 accent-sky-700"
                          checked={selected.some((s) => s.shopId === shop.id)}
                          onChange={(e) =>
                            state.toggleShop(shop.id, e.target.checked)
                          }
                          aria-label={shop.name}
                          aria-describedby={`shop-capability-${shop.id}`}
                        />
                        <span>
                          <span className="block font-semibold">
                            {shop.name}
                          </span>
                          <span
                            id={`shop-capability-${shop.id}`}
                            className="mt-1 block text-xs text-slate-500"
                          >
                            {shop.capabilityMessage ??
                              (shop.comparisonSupported
                                ? "Product comparisons supported"
                                : "Comparison not available yet. You can save this preference for later.")}
                          </span>
                        </span>
                      </label>
                      {shop.code === "aldi" && !shop.comparisonSupported && (
                        <div className="ml-8 text-xs">
                          <p className="mt-1 text-slate-600">
                            Use Refresh items with the extension enabled to update
                            saved ALDI prices. Prices may vary by store.
                          </p>
                          <a
                            href="https://www.aldi.com.au/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-block min-h-11 py-3 font-semibold text-sky-700 underline"
                          >
                            Visit ALDI’s website
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                  <PreferredShopBranches store={store} />
                  <label className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 border-t border-slate-200 pt-5">
                    <input
                      type="checkbox"
                      className="size-5 accent-sky-700"
                      checked={draft.compareOnlyPreferredShops}
                      onChange={(e) => state.setPreferredOnly(e.target.checked)}
                    />
                    Compare only my stores
                  </label>
                  <p className="text-sm text-slate-500">
                    Turn this off to compare all supported stores. Adding a
                    product from another supported store still saves that
                    product to your list.
                  </p>
                  {draft.compareOnlyPreferredShops && !selected.length && (
                    <p className="text-sm text-amber-800">
                      Choose at least one store, or turn off Compare only my
                      stores.
                    </p>
                  )}
                  {unsupportedOnly && (
                    <p
                      role="status"
                      className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
                    >
                      Automatic product searches are unavailable for your selected
                      stores.{" "}{hasAldiSelection
                        ? "Saved ALDI prices from your extension can still be compared. Use Refresh items to update them."
                        : "Comparison prices are not available for these stores yet. You can keep these preferences for later, or choose a supported store."}
                    </p>
                  )}
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 border-t border-slate-200 pt-5">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-sky-700"
                      checked={draft.includeDifferentPackSizes}
                      onChange={(e) =>
                        state.setDifferentPackSizes(e.target.checked)
                      }
                    />
                    Show different package sizes
                  </label>
                  <p className="text-sm text-slate-500">
                    Show other saved sizes of the same brand and product.
                    Compare package cost and price per unit before choosing.
                    Your list and totals stay as they are.
                  </p>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 border-t border-slate-200 pt-5">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-sky-700"
                      checked={draft.includeDifferentBrands}
                      onChange={(e) =>
                        state.setDifferentBrands(e.target.checked)
                      }
                      aria-describedby="alternative-brands-help"
                    />
                    Show alternative brands
                  </label>
                  <p
                    id="alternative-brands-help"
                    className="text-sm text-slate-500"
                  >
                    Automatically search selected supported stores for similar products from other brands after adding an item. Show suggestions and reviewed alternatives when saved prices are available. Taste, ingredients and quality may
                    differ. Check the product details for your needs. Your list
                    and totals stay as they are.
                  </p>
                  <button
                    type="submit"
                    disabled={
                      disabled ||
                      (draft.compareOnlyPreferredShops && !selected.length)
                    }
                    className="min-h-11 rounded-xl bg-sky-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    {state.saving ? "Saving…" : "Save My Stores"}
                  </button>
                </fieldset>
              </form>
            )}
          </>
        )}
        {state.notice && (
          <p
            role="status"
            className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"
          >
            {state.notice}
          </p>
        )}
        <Link
          href="/"
          className="mt-7 inline-block min-h-11 font-semibold text-sky-700 underline"
        >
          Back to my lists
        </Link>
      </main>
    </div>
  );
}
