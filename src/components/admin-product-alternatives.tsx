"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { BrandAlternativeReviewProduct, ListItem } from "@/lib/api-types";
import { createAdminProductAlternativesStore } from "@/stores/admin-product-alternatives-store";

const button =
  "min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50";
const input =
  "mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2";
function pack(p: ListItem["product"]) {
  if (p.packSize === null || !p.packUnit) return "Pack size unavailable";
  return `${p.packQuantity && p.packQuantity > 1 ? `${p.packQuantity} × ` : ""}${p.packSize} ${p.packUnit}`;
}
function ProductDetails({
  data,
  title,
}: {
  data: BrandAlternativeReviewProduct;
  title: string;
}) {
  const p = data.product;
  return (
    <section
      aria-label={title}
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 wrap-break-word font-semibold">{p.name}</p>
      <dl className="mt-3 space-y-2 text-sm">
        {[
          ["Product ID", p.id],
          ["Brand", p.brand],
          ["Variant", p.variant],
          ["Package", pack(p)],
          ["Category", data.category],
          ["Subcategory", data.subCategory],
          ["GTIN", data.gtin],
          ["Manufacturer part number", data.manufacturerPartNumber],
          ["Model", data.modelNumber],
        ].map(([name, value]) => (
          <div key={name}>
            <dt className="font-semibold">{name}</dt>
            <dd className="wrap-break-word text-slate-600">
              {value ?? "Unavailable"}
            </dd>
          </div>
        ))}
      </dl>
      {data.isDeleted && (
        <p className="mt-3 font-semibold text-amber-900">
          Retired product — approval unavailable; existing relationships can be
          withdrawn.
        </p>
      )}
      <details className="mt-3" open>
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          Description and item details
        </summary>
        <p className="whitespace-pre-wrap wrap-break-word text-sm">
          {data.description ?? "Description unavailable."}
        </p>
        <p className="mt-3 whitespace-pre-wrap wrap-break-word text-sm">
          {data.itemDetail ??
            "Item details unavailable. Check a trustworthy source before confirming suitability."}
        </p>
      </details>
    </section>
  );
}
export default function AdminProductAlternatives() {
  const [store] = useState(createAdminProductAlternativesStore);
  const state = useStore(store);
  useEffect(() => {
    void store.getState().initialise();
    const changed = () => {
      void store.getState().initialise();
    };
    window.addEventListener("myshoppinglist-session-changed", changed);
    return () => {
      window.removeEventListener("myshoppinglist-session-changed", changed);
      store.getState().dispose();
    };
  }, [store]);
  const context = state.context;
  const latest = context?.reviews[0];
  const locked = state.busy || state.saving || state.denied || !state.accountId;
  const reviewLocked = locked || state.conflict;
  const evidenceValid =
    state.evidence.trim().length > 0 && state.evidence.length <= 2000;
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 text-slate-900 sm:p-6">
      <nav
        aria-label="Administration"
        className="flex flex-wrap gap-5 text-sm font-semibold text-sky-700 underline"
      >
        <Link href="/admin">Account administration</Link>
        <Link href="/admin/shop-locations">Branch administration</Link>
        <Link href="/admin/health">Retailer health</Link>
        <Link href="/">MyShoppingList / sign in</Link>
      </nav>
      <h1 className="text-3xl font-semibold">Product alternative reviews</h1>
      <p className="max-w-3xl text-sm leading-6 text-slate-600">
        Review saved products from different brands before customers can see
        them as alternatives. Approval applies in both directions. It does not
        claim identical taste, ingredients or quality.
      </p>
      {state.error && (
        <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 p-4 text-emerald-900"
        >
          {state.notice}
        </p>
      )}
      {state.saving && <p role="status">Saving reviewed decision…</p>}
      {state.busy && (
        <p role="status">Loading review access or product details…</p>
      )}
      {!state.accountId && !state.busy && (
        <button className={button} onClick={() => void state.initialise()}>
          Retry access check
        </button>
      )}
      {!state.denied && state.accountId && (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            {(["first", "second"] as const).map((slot, index) => {
              const value = state[slot],
                title = `Product ${index === 0 ? "A" : "B"}`;
              return (
                <section
                  key={slot}
                  aria-label={`Choose ${title}`}
                  className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <h2 className="text-lg font-semibold">Choose {title}</h2>
                  <form
                    className="mt-3 space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void state.search(slot);
                    }}
                  >
                    <label className="block text-sm font-semibold">
                      Search {title}
                      <input
                        className={input}
                        value={value.query}
                        maxLength={100}
                        disabled={locked}
                        placeholder="Name, brand or product ID"
                        onChange={(event) =>
                          state.setQuery(slot, event.target.value)
                        }
                      />
                    </label>
                    <p className="text-xs text-slate-600">
                      Use at least two characters, or a positive product ID.
                      Searches saved products only.
                    </p>
                    <button
                      className={button}
                      disabled={locked || value.busy || !value.query.trim()}
                    >
                      {value.busy ? "Searching…" : `Search ${title}`}
                    </button>
                  </form>
                  {value.selected && (
                    <p role="status" className="mt-3 wrap-break-word text-sm">
                      Selected: {value.selected.product.name} · ID{" "}
                      {value.selected.product.id}
                      {value.selected.isDeleted ? " · Retired" : ""}
                    </p>
                  )}
                  {value.result && (
                    <>
                      {!value.result.items.length && (
                        <p className="mt-3 text-sm">
                          No saved products found. Try another name, brand or
                          product ID.
                        </p>
                      )}
                      {value.result.hasMore && (
                        <p className="mt-3 text-sm text-amber-900">
                          Showing the first 50 matches. Refine your search to
                          find the product.
                        </p>
                      )}
                      <ul className="mt-3 space-y-2">
                        {value.result.items.map((result) => (
                          <li key={result.product.id}>
                            <button
                              type="button"
                              disabled={locked}
                              onClick={() => state.select(slot, result)}
                              className={`${button} w-full bg-white text-left wrap-break-word`}
                            >
                              <span className="block">
                                {result.product.name}
                              </span>
                              <span className="mt-1 block text-xs font-normal">
                                ID {result.product.id} ·{" "}
                                {result.product.brand ?? "Brand unavailable"} ·{" "}
                                {pack(result.product)}
                                {result.isDeleted ? " · Retired" : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              );
            })}
          </div>
          <button
            type="button"
            className={button}
            disabled={locked || !state.first.selected || !state.second.selected}
            onClick={() => void state.load()}
          >
            {state.conflict || context
              ? "Reload product review"
              : "Load product review"}
          </button>
          {state.conflict && (
            <p className="text-sm text-amber-900">
              Reload the review and inspect both products again. Previous
              confirmations have been cleared.
            </p>
          )}
          {context && (
            <>
              <p
                role="status"
                className="rounded-xl bg-slate-100 p-4 font-semibold"
              >
                Relationship status:{" "}
                {latest
                  ? !latest.approved
                    ? "Withdrawn"
                    : latest.needsReview
                      ? "Needs review — product details changed"
                      : "Approved"
                  : "Not reviewed"}
              </p>
              <div className="grid gap-5 md:grid-cols-2">
                <ProductDetails
                  data={context.product}
                  title="Review product A"
                />
                <ProductDetails
                  data={context.alternativeProduct}
                  title="Review product B"
                />
              </div>
              <form
                className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void state.save(true);
                }}
              >
                <h2 className="text-xl font-semibold">
                  Record a reviewed decision
                </h2>
                <p className="text-sm text-slate-600">
                  Approval requires different brands, matching categories and
                  variants, and clear comparable pack sizes. Check trustworthy
                  evidence for intended use, format, dietary attributes and
                  composition. Missing information is not proof of suitability.
                </p>
                <fieldset
                  disabled={reviewLocked}
                  className="space-y-4 disabled:opacity-60"
                >
                  <legend className="sr-only">
                    Suitability confirmations and evidence
                  </legend>
                  <label className="flex min-h-11 items-start gap-3">
                    <input
                      className="mt-1 size-5 shrink-0"
                      type="checkbox"
                      checked={state.sameUse}
                      onChange={(event) =>
                        state.setConfirmation("sameUse", event.target.checked)
                      }
                    />
                    I checked that these products have the same intended use and
                    compatible format.
                  </label>
                  <label className="flex min-h-11 items-start gap-3">
                    <input
                      className="mt-1 size-5 shrink-0"
                      type="checkbox"
                      checked={state.composition}
                      onChange={(event) =>
                        state.setConfirmation(
                          "composition",
                          event.target.checked,
                        )
                      }
                    />
                    I checked dietary attributes and composition for
                    suitability.
                  </label>
                  <label className="block font-semibold">
                    Review evidence or withdrawal reason
                    <textarea
                      className={input}
                      rows={4}
                      maxLength={2000}
                      value={state.evidence}
                      onChange={(event) =>
                        state.setEvidence(event.target.value)
                      }
                    />
                  </label>
                  <p className="text-xs text-slate-600">
                    Describe what you checked and identify the source. Do not
                    include customer information. A withdrawal needs a reason
                    but does not require suitability confirmations.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      className={`${button} bg-sky-700 text-white`}
                      disabled={
                        !evidenceValid ||
                        !state.sameUse ||
                        !state.composition ||
                        context.product.isDeleted ||
                        context.alternativeProduct.isDeleted
                      }
                    >
                      Approve alternative
                    </button>
                    <button
                      type="button"
                      className={button}
                      disabled={!evidenceValid || !latest?.approved}
                      onClick={() => void state.save(false)}
                    >
                      Withdraw approval
                    </button>
                  </div>
                </fieldset>
              </form>
              <section
                aria-label="Review history"
                className="rounded-xl border border-slate-200 p-5"
              >
                <h2 className="text-xl font-semibold">Review history</h2>
                <p className="mt-2 text-xs text-slate-600">
                  Newest first. Up to 100 previous decisions are shown.
                </p>
                {!context.reviews.length && (
                  <p className="mt-3">No previous decisions for this pair.</p>
                )}
                <ol className="mt-4 space-y-4">
                  {context.reviews.map((review) => (
                    <li
                      key={review.id}
                      className="border-t border-slate-200 pt-3 text-sm"
                    >
                      <p className="font-semibold">
                        {review.approved ? "Approved" : "Withdrawn"} · Review{" "}
                        {review.id}
                      </p>
                      <p className="mt-1 text-slate-600">
                        {new Date(review.reviewedAt).toLocaleString("en-AU")} ·
                        Reviewer account {review.reviewerAccountId}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap wrap-break-word">
                        {review.evidence}
                      </p>
                      {review.approved && review.needsReview && (
                        <p className="mt-2 text-amber-900">
                          This decision refers to older or incompatible product
                          details.
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
