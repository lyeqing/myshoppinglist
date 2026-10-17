"use client";

import { useStore } from "zustand";
import type { ShopLocationSummary } from "@/lib/api-types";
import type { createShoppingPreferencesStore } from "@/stores/shopping-preferences-store";

const control =
  "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100";
const button =
  "min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50";
function address(branch: ShopLocationSummary) {
  return [
    branch.address1,
    branch.address2,
    branch.suburb,
    branch.state,
    branch.postcode,
  ]
    .filter(Boolean)
    .join(", ");
}
function verified(value: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString("en-AU")
    : "Not recorded";
}
export default function PreferredShopBranches({
  store,
}: {
  store: ReturnType<typeof createShoppingPreferencesStore>;
}) {
  const state = useStore(store),
    draft = state.draft;
  if (!draft) return null;
  const branches = draft.branches ?? [];
  const enabled = draft.availableShops.filter((shop) =>
    draft.shops.some((s) => s.shopId === shop.id && s.isEnabled),
  );
  const locked = state.loading || state.saving || state.conflict;
  const canSearch =
    !locked &&
    enabled.some((s) => s.id === state.branchShopId) &&
    state.branchQuery.trim().length !== 1;
  return (
    <section
      aria-label="Preferred branches"
      className="space-y-4 border-t border-slate-200 pt-5"
    >
      <h2 className="text-lg font-semibold">Your branches (optional)</h2>
      <p className="text-sm leading-6 text-slate-600">
        Save the branches you visit. Branch-specific prices are unavailable;
        comparisons and price refreshes continue to use supermarket prices. A
        saved branch does not confirm product availability.
      </p>
      {branches.length === 0 ? (
        <p className="text-sm text-slate-600">
          No branches selected. You can use MyShoppingList without choosing a
          branch.
        </p>
      ) : (
        <ul aria-label="Selected branches" className="space-y-3">
          {branches.map((branch) => (
            <li
              key={branch.location.id}
              className="rounded-xl border border-slate-200 p-4 wrap-break-word"
            >
              <p className="font-semibold">
                {branch.location.shopName} · {branch.location.name}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {address(branch.location)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Directory last verified: {verified(branch.location.verifiedAt)}
              </p>
              {!branch.isAvailable && (
                <p className="mt-2 text-sm text-amber-900">
                  {branch.unavailableReason ??
                    "This branch is unavailable. Remove it or choose another branch."}
                </p>
              )}
              {!draft.shops.some(
                (s) => s.shopId === branch.location.shopId && s.isEnabled,
              ) && (
                <p className="mt-2 text-sm text-slate-600">
                  Saved for later. {branch.location.shopName} is not enabled in
                  My Stores. Your branch selection is kept.
                </p>
              )}
              <button
                type="button"
                className={`${button} mt-2`}
                disabled={locked}
                aria-label={`Remove ${branch.location.name}`}
                onClick={() => state.removeBranch(branch.location.id)}
              >
                Remove branch
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-xl bg-slate-50 p-4">
        <h3 className="font-semibold">Find a branch</h3>
        {!enabled.length && (
          <p className="mt-2 text-sm text-slate-600">
            Enable a supermarket above to find its verified branches.
          </p>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            Search supermarket
            <select
              aria-label="Search supermarket"
              className={`${control} mt-1`}
              disabled={locked || !enabled.length}
              value={state.branchShopId ?? ""}
              onChange={(event) =>
                state.setBranchFilter(
                  Number(event.target.value) || null,
                  state.branchQuery,
                )
              }
            >
              <option value="">Choose a supermarket</option>
              {enabled.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Branch name, suburb or postcode
            <input
              className={`${control} mt-1`}
              maxLength={100}
              disabled={locked || !enabled.length}
              value={state.branchQuery}
              placeholder="For example, Marion or 5043"
              onChange={(event) =>
                state.setBranchFilter(state.branchShopId, event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (canSearch) void state.searchBranches();
                }
              }}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Use at least two characters, or leave blank to browse the selected
          supermarket. Only verified, active branches are listed.
        </p>
        <button
          type="button"
          className={`${button} mt-3 bg-white`}
          disabled={!canSearch || state.branchSearching}
          onClick={() => void state.searchBranches()}
        >
          Search branches
        </button>
        {state.branchSearching && (
          <p role="status" className="mt-3 text-sm">
            Finding branches…
          </p>
        )}
        {state.branchError && (
          <p role="alert" className="mt-3 text-sm text-amber-900">
            {state.branchError}
          </p>
        )}
        {state.branchResult && (
          <div className="mt-4 space-y-3">
            {!state.branchResult.items.length && (
              <p className="text-sm">
                No verified branches found. Try another name, suburb or
                postcode. You can save your supermarket preferences without a
                branch.
              </p>
            )}
            {state.branchResult.hasMore && (
              <p className="text-sm text-amber-900">
                Showing the first 50 matches. Refine your search to find your
                branch.
              </p>
            )}
            <ul aria-label="Branch search results" className="space-y-3">
              {state.branchResult.items.map((branch) => {
                const selected = branches.some(
                  (b) => b.location.id === branch.id,
                );
                return (
                  <li
                    key={branch.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 wrap-break-word"
                  >
                    <p className="font-semibold">{branch.name}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {address(branch)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Directory last verified: {verified(branch.verifiedAt)}
                    </p>
                    <button
                      type="button"
                      className={`${button} mt-2`}
                      aria-label={
                        selected
                          ? `${branch.name} selected`
                          : `Add ${branch.name}`
                      }
                      disabled={locked || selected || branches.length >= 100}
                      onClick={() => state.addBranch(branch)}
                    >
                      {selected ? "Selected" : "Add branch"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">
        {branches.length >= 100
          ? "You have reached the limit of 100 saved branches. Remove one to add another. "
          : ""}
        Branch changes are saved when you choose Save My Stores.
      </p>
    </section>
  );
}
