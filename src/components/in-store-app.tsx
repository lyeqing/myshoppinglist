"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AccountForm from "./account-form";
import { useStore } from "zustand";
import {
  createInStoreStore,
  itemGroup as groupByPrice,
} from "@/stores/in-store-store";
import type { InStoreItem, InStorePrice } from "@/lib/api-types";

function lineTotal(price: InStorePrice, quantity: number) {
  return price.quantityPrice?.quantity === quantity
    ? price.quantityPrice.total
    : price.price! * quantity;
}

function itemGroup(row: InStoreItem, shopId: number | null) {
  return groupByPrice(
    {
      ...row,
      prices: row.prices.map((p) => ({
        ...p,
        price: p.price === null ? null : lineTotal(p, row.item.quantity),
      })),
    },
    shopId,
  );
}

const money = (value: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(
    value,
  );
const button =
  "min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const tones = [
  "border-emerald-200 bg-emerald-50 text-emerald-950",
  "border-sky-200 bg-sky-50 text-sky-950",
  "border-slate-200 bg-slate-50 text-slate-800",
  "border-amber-200 bg-amber-50 text-amber-950",
  "border-slate-200 bg-white text-slate-600",
  "border-red-200 bg-red-50 text-red-950",
];

export default function InStoreApp() {
  const [store] = useState(createInStoreStore);
  const state = useStore(store);
  const [signingIn, setSigningIn] = useState(false);
  const name = state.session?.account.displayName.trim() || "Shopper";
  const parts = name.split(/\s+/);
  const initials = [parts[0], ...(parts.length > 1 ? [parts.at(-1)!] : [])]
    .map((p) => Array.from(p)[0])
    .join("")
    .toLocaleUpperCase();
  const { load, dispose } = state;
  useEffect(() => {
    void load(null);
    return dispose;
  }, [load, dispose]);
  useEffect(() => {
    const changed = () => {
      setSigningIn(false);
      dispose();
      store.setState({
        session: null,
        lists: [],
        detail: null,
        selectedList: null,
        shopId: null,
        saving: false,
        authBusy: false,
      });
      void load(null);
    };
    window.addEventListener("myshoppinglist-session-changed", changed);
    return () =>
      window.removeEventListener("myshoppinglist-session-changed", changed);
  }, [store, load, dispose]);
  const retailers = state.detail?.retailers ?? [
    ...new Map(
      state.lists.flatMap((l) => l.retailers).map((s) => [s.id, s]),
    ).values(),
  ];
  const selected = retailers.find((s) => s.id === state.shopId);
  const detail = state.detail;
  const disabled = state.loading || state.saving || state.authBusy;
  const rows =
    detail?.items
      .filter((row) => state.showPurchased || !row.item.isPurchased)
      .slice()
      .sort(
        (a, b) =>
          (selected
            ? itemGroup(a, selected.id) - itemGroup(b, selected.id)
            : 0) || a.item.product.name.localeCompare(b.item.product.name),
      ) ?? [];
  const labels = [
    `Cheaper at ${selected?.name}`,
    `${selected?.name} price only`,
    "Same price",
    "Better price elsewhere",
    "Price unavailable",
    "Unavailable at this retailer",
  ];
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link href="/" className="font-semibold text-sky-800">
            MyShoppingList
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex gap-4 text-sm font-semibold"
          >
            <Link href="/">My lists</Link>
            <Link href="/in-store" aria-current="page" className="text-sky-700">
              Shop in store
            </Link>
            {state.session?.account.isPaid && (
              <Link href="/history">History</Link>
            )}
          </nav>
          <div className="flex items-center gap-3">
            {state.session && !state.session.account.isTrial && (
              <div
                role="group"
                aria-label={`Signed in as ${name}`}
                title={name}
                className="flex items-center gap-2"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-800"
                >
                  {initials}
                </span>
                <span className="hidden max-w-40 truncate text-sm sm:block">
                  {name}
                </span>
              </div>
            )}
            {(!state.session || state.session.account.isTrial) && (
              <button
                className={button}
                disabled={disabled}
                onClick={() => setSigningIn(true)}
              >
                Sign in
              </button>
            )}
            {state.session && (
              <button
                className={button}
                disabled={disabled}
                onClick={() => {
                  setSigningIn(false);
                  void state.logout();
                }}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
        <div hidden={!signingIn}>
          {signingIn && (
            <AccountForm
              mode="login"
              trial={state.session?.account.isTrial ?? false}
              onBusy={state.setAuthBusy}
              onClose={() => setSigningIn(false)}
              onSuccess={(session) => {
                setSigningIn(false);
                state.accountReady(session);
              }}
            />
          )}
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-sky-700">
          Your shopping companion
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Shop in store
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Estimated—prices may vary by store. Fresh prices follow the Wednesday
          catalogue cycle.
        </p>
        <section
          aria-label="Choose retailer"
          className="sticky top-0 z-10 my-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <label
            htmlFor="retailer"
            className="mb-2 block text-sm font-semibold"
          >
            Where are you shopping?
          </label>
          <div className="flex flex-wrap gap-3">
            <select
              id="retailer"
              value={state.shopId ?? ""}
              disabled={disabled || !retailers.length}
              onChange={(e) =>
                state.selectShop(e.target.value ? Number(e.target.value) : null)
              }
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3"
            >
              <option value="">Choose a retailer</option>
              {retailers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              className={button}
              disabled={disabled}
              onClick={() => void load()}
            >
              Refresh prices
            </button>
          </div>
          {!state.loading && !retailers.length && (
            <p className="mt-2 text-sm text-slate-500">
              No retailer matches saved yet.
            </p>
          )}
        </section>
        {state.error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4"
          >
            <p>{state.error}</p>
            {state.unauthorized ? (
              <span className="mt-2 block text-sm">
                Use Sign in above to open your lists here.
              </span>
            ) : (
              <button
                className={`${button} mt-3`}
                onClick={() => void load()}
                disabled={disabled}
              >
                Retry
              </button>
            )}
          </div>
        )}
        {state.loading && (
          <p role="status" className="mb-4">
            Loading your shopping lists…
          </p>
        )}
        {state.notice && (
          <p
            role="status"
            className="mb-4 rounded-xl bg-emerald-50 p-4 text-emerald-900"
          >
            {state.notice}
          </p>
        )}
        {state.saving && (
          <p role="status" className="mb-4">
            Saving purchase…
          </p>
        )}
        {!state.selectedList && !state.unauthorized && (
          <section aria-label="Your lists">
            <h2 className="mb-4 text-xl font-semibold">Your lists</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {state.lists.map((list) => (
                <button
                  key={list.id}
                  disabled={disabled}
                  onClick={() => void load(list.id)}
                  className="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-sky-500 disabled:opacity-50"
                >
                  <span className="block text-lg font-semibold">
                    {list.name}
                  </span>
                  <span className="mt-2 block text-sm text-slate-500">
                    {list.remainingCount} items remaining
                  </span>
                  <span className="mt-3 block text-xs text-sky-700">
                    {list.retailers.map((s) => s.name).join(" · ") ||
                      "Awaiting retailer matches"}
                  </span>
                </button>
              ))}
            </div>
            {!state.loading && !state.lists.length && (
              <p>
                No shopping lists yet.{" "}
                <Link href="/" className="underline">
                  Add products to get started.
                </Link>
              </p>
            )}
          </section>
        )}
        {state.selectedList && (
          <button
            className={`${button} mb-4`}
            disabled={disabled}
            onClick={() => void load(null)}
          >
            ← All lists
          </button>
        )}
        {detail && (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold">{detail.name}</h2>
                <p className="text-sm text-slate-500">
                  {detail.remainingCount} items remaining
                </p>
              </div>
              <button
                className={button}
                aria-pressed={state.showPurchased}
                onClick={state.togglePurchasedVisibility}
              >
                {state.showPurchased ? "Hide purchased" : "Show purchased"}
              </button>
            </div>
            <section
              aria-label="Basket estimates"
              className="mb-7 rounded-2xl border border-slate-200 bg-white p-5"
            >
              <h3 className="text-lg font-semibold">Plan your shop</h3>
              <p className="mt-1 text-xs text-slate-500">
                Remaining items only. Totals include requested quantities.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {detail.baskets.map((b) => (
                  <div
                    key={b.shopId}
                    className={`rounded-xl border p-4 ${b.pricedCount < detail.remainingCount ? "border-red-200 bg-red-50 text-red-950" : "border-transparent bg-slate-50"}`}
                  >
                    <p className="text-sm font-medium">Only {b.shopName}</p>
                    {b.pricedCount < detail.remainingCount && (
                      <p className="mt-2 text-sm font-semibold">
                        Incomplete basket — {b.pricedCount} of{" "}
                        {detail.remainingCount} items priced
                      </p>
                    )}
                    <p className="mt-1 text-2xl font-semibold">
                      {money(b.subtotal)}
                      {b.pricedCount < detail.remainingCount && (
                        <span className="text-sm font-normal">
                          {" "}
                          subtotal only
                        </span>
                      )}
                    </p>
                    <p className="text-xs">
                      {b.pricedCount === detail.remainingCount
                        ? "Estimated total"
                        : "Subtotal"}{" "}
                      · {b.pricedCount} of {detail.remainingCount} items priced
                    </p>
                    {b.pricedCount < detail.remainingCount && (
                      <p className="mt-2 text-xs">
                        {
                          detail.items.filter(
                            (r) =>
                              !r.item.isPurchased &&
                              !r.item.isHidden &&
                              !r.prices.some((p) => p.shopId === b.shopId),
                          ).length
                        }{" "}
                        not found ·{" "}
                        {
                          detail.items.filter(
                            (r) =>
                              !r.item.isPurchased &&
                              !r.item.isHidden &&
                              r.prices.some(
                                (p) =>
                                  p.shopId === b.shopId &&
                                  p.status === "Out of stock",
                              ),
                          ).length
                        }{" "}
                        out of stock ·{" "}
                        {
                          detail.items.filter(
                            (r) =>
                              !r.item.isPurchased &&
                              !r.item.isHidden &&
                              r.prices.some(
                                (p) =>
                                  p.shopId === b.shopId &&
                                  p.price === null &&
                                  p.status !== "Out of stock",
                              ),
                          ).length
                        }{" "}
                        prices unavailable
                      </p>
                    )}
                  </div>
                ))}
                <div className="rounded-xl bg-emerald-50 p-4">
                  <p className="text-sm font-medium">
                    Cheapest across retailers
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-800">
                    {money(detail.splitSubtotal)}
                  </p>
                  <p className="text-xs text-emerald-900">
                    {detail.splitPricedCount === detail.remainingCount
                      ? "Estimated total"
                      : "Subtotal"}{" "}
                    · {detail.splitPricedCount} of {detail.remainingCount} items
                    priced
                  </p>
                </div>
              </div>
              {detail.comparableCount > 0 ? (
                <div className="mt-4 text-sm">
                  <p>
                    For the {detail.comparableCount} items priced at both
                    retailers, splitting costs{" "}
                    {money(detail.comparableSplitSubtotal)}.
                  </p>
                  {detail.baskets.map((b) => (
                    <p key={b.shopId}>
                      Save {money(b.savingsBySplitting)} compared with{" "}
                      {b.shopName} only ({money(b.comparableSubtotal)} for those
                      same items).
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  Savings need fresh prices at both retailers for the same
                  items.
                </p>
              )}
            </section>
            {!selected && (
              <p className="mb-4 text-sm text-slate-600">
                Choose a retailer above to put its best buys first.
              </p>
            )}
            <div className="space-y-4">
              {rows.map((row, index) => {
                const group = selected ? itemGroup(row, selected.id) : 4;
                const prices = row.prices
                  .filter((p) => p.price !== null)
                  .sort(
                    (a, b) =>
                      lineTotal(a, row.item.quantity) -
                      lineTotal(b, row.item.quantity),
                  );
                const best = prices[0];
                const second = prices[1];
                const current = row.prices.find(
                  (p) => p.shopId === selected?.id,
                );
                const alternative = prices.find(
                  (p) => p.shopId !== selected?.id,
                );
                const heading =
                  selected &&
                  (index === 0 ||
                    itemGroup(rows[index - 1], selected.id) !== group);
                return (
                  <div key={row.item.id}>
                    {heading && (
                      <h3 className="mb-3 mt-6 text-base font-semibold">
                        {labels[group]}
                      </h3>
                    )}
                    <article
                      className={`rounded-2xl border p-5 ${tones[group]} ${row.item.isPurchased ? "opacity-65" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words text-lg font-semibold">
                            {row.item.product.name}
                          </h4>
                          <p className="mt-1 text-sm">
                            {[row.item.product.brand, row.item.product.variant]
                              .filter(Boolean)
                              .join(" · ")}{" "}
                            · Quantity {row.item.quantity}
                          </p>
                          {row.item.product.packSize != null && (
                            <p className="mt-1 text-xs">
                              {row.item.product.packQuantity &&
                              row.item.product.packQuantity > 1
                                ? `${row.item.product.packQuantity} × `
                                : ""}
                              {row.item.product.packSize}
                              {row.item.product.packUnit}
                            </p>
                          )}
                          {row.item.notes && (
                            <p className="mt-2 break-words text-sm">
                              {row.item.notes}
                            </p>
                          )}
                        </div>
                        <label className="flex min-h-11 shrink-0 cursor-pointer flex-col items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            className="size-6 accent-sky-700"
                            checked={row.item.isPurchased}
                            disabled={disabled}
                            aria-label={`Purchased ${row.item.product.name}`}
                            onChange={() => void state.purchase(row)}
                          />
                          Purchased
                        </label>
                      </div>
                      {selected ? (
                        <div className="mt-4">
                          <p className="text-sm font-medium">{selected.name}</p>
                          {current?.price != null ? (
                            <>
                              <p className="text-2xl font-semibold">
                                {money(lineTotal(current, row.item.quantity))}{" "}
                                <span className="text-xs font-normal">
                                  for your quantity · {money(current.price)}{" "}
                                  single-item price
                                </span>
                              </p>
                              {alternative && (
                                <p className="mt-2 text-sm">
                                  {lineTotal(alternative, row.item.quantity) <
                                  lineTotal(current, row.item.quantity)
                                    ? `Best price at ${alternative.shopName}: ${money(lineTotal(alternative, row.item.quantity))} for your quantity. Save ${money(lineTotal(current, row.item.quantity) - lineTotal(alternative, row.item.quantity))} on your quantity.`
                                    : lineTotal(
                                          alternative,
                                          row.item.quantity,
                                        ) ===
                                        lineTotal(current, row.item.quantity)
                                      ? `Same price at ${alternative.shopName}.`
                                      : `${alternative.shopName}: ${money(lineTotal(alternative, row.item.quantity))} for your quantity. Save ${money(lineTotal(alternative, row.item.quantity) - lineTotal(current, row.item.quantity))} at ${selected.name}.`}
                                </p>
                              )}
                            </>
                          ) : (
                            <>
                              <p className="text-lg font-semibold">
                                {!current
                                  ? `Not found at ${selected.name}`
                                  : current.status === "Out of stock"
                                    ? `Out of stock at ${selected.name}`
                                    : `Price unavailable at ${selected.name}`}
                              </p>
                              {!current && (
                                <p className="mt-1 text-xs">
                                  No saved exact match at this retailer.
                                </p>
                              )}
                              {alternative && (
                                <p className="mt-2 text-sm">
                                  Available price at {alternative.shopName}:{" "}
                                  {money(alternative.price!)} each ·{" "}
                                  {money(
                                    lineTotal(alternative, row.item.quantity),
                                  )}{" "}
                                  for your quantity
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      ) : best ? (
                        <div className="mt-4">
                          <p className="text-sm">
                            {second &&
                            lineTotal(second, row.item.quantity) ===
                              lineTotal(best, row.item.quantity)
                              ? `Equal best: ${prices
                                  .filter(
                                    (p) =>
                                      lineTotal(p, row.item.quantity) ===
                                      lineTotal(best, row.item.quantity),
                                  )
                                  .map((p) => p.shopName)
                                  .join(" & ")}`
                              : `Best price: ${best.shopName}`}
                          </p>
                          <p className="text-2xl font-semibold">
                            {money(lineTotal(best, row.item.quantity))}{" "}
                            <span className="text-xs font-normal">
                              for your quantity · {money(best.price!)}{" "}
                              single-item price
                            </span>
                          </p>
                          {second && (
                            <p className="mt-2 text-sm">
                              Second price: {second.shopName}{" "}
                              {money(lineTotal(second, row.item.quantity))} ·
                              Save{" "}
                              {money(
                                lineTotal(second, row.item.quantity) -
                                  lineTotal(best, row.item.quantity),
                              )}{" "}
                              on your quantity
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-4 text-sm">
                          No fresh comparable price available.
                        </p>
                      )}
                      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-current/10 pt-3 text-xs">
                        {row.prices.map((p) => (
                          <p key={p.shopId}>
                            {p.shopName}:{" "}
                            {p.price === null
                              ? p.status
                              : `${money(p.price)} single-item price`}
                            {p.multibuy && (
                              <span className="mt-1 block font-semibold">
                                Buy {p.multibuy.quantity} for{" "}
                                {money(p.multibuy.total)}.
                                {p.quantityPrice?.quantity ===
                                  row.item.quantity &&
                                p.quantityPrice.appliedBundles > 0
                                  ? ` Deal applied ${p.quantityPrice.appliedBundles} time(s): ${money(p.quantityPrice.total)} total; save ${money(p.quantityPrice.savings)} (normally ${money(p.quantityPrice.ordinaryTotal)}).${p.quantityPrice.remainingQuantity ? ` ${p.quantityPrice.remainingQuantity} remaining at the single-item price.` : ""}`
                                  : " Single-item price used; quantity does not qualify."}
                              </span>
                            )}
                            {p.checkedDate && (
                              <span className="block opacity-70">
                                Checked{" "}
                                {new Date(p.checkedDate).toLocaleString(
                                  "en-AU",
                                )}
                              </span>
                            )}
                          </p>
                        ))}
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>
            {!rows.length && (
              <p className="rounded-2xl bg-white p-6">
                {detail.items.length
                  ? "All done! Your remaining shopping list is empty."
                  : "This list has no visible products yet."}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
