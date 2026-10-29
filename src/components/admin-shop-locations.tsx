"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type {
  ShopLocationDetails,
  ShopLocationReviewResponse,
} from "@/lib/api-types";
import { createAdminShopLocationsStore } from "@/stores/admin-shop-locations-store";

const states = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];
const button =
  "min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50";
const input =
  "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100 read-only:bg-slate-100";
const date = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("en-AU")
    : "Not verified";
function snapshot(value: string | null): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
function RecordedChanges({ review }: { review: ShopLocationReviewResponse }) {
  const before = snapshot(review.beforeJson),
    after = snapshot(review.afterJson);
  const fields = [
    ["Name", "Branch name"],
    ["StoreCode", "Retailer branch code"],
    ["ShopId", "Retailer ID"],
    ["Address1", "Street address"],
    ["Address2", "Additional address"],
    ["Suburb", "Suburb"],
    ["State", "State"],
    ["Postcode", "Postcode"],
    ["IsActive", "Active branch"],
    ["SourceReference", "Verification source"],
    ["VerifiedAt", "Last verified"],
    ["Latitude", "Latitude"],
    ["Longitude", "Longitude"],
  ];
  const display = (value: unknown, key: string) =>
    value === null || value === undefined || value === ""
      ? "Not recorded"
      : key === "VerifiedAt" && typeof value === "string"
        ? date(value)
        : typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : String(value);
  return (
    <details className="mt-2">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">
        Recorded changes
      </summary>
      {!after ? (
        <p>
          Saved details cannot be displayed. Review the evidence and source
          reference.
        </p>
      ) : (
        <dl className="space-y-2">
          {fields
            .filter(([key]) =>
              before
                ? before[key] !== after[key]
                : after[key] !== null && after[key] !== undefined,
            )
            .map(([key, label]) => (
              <div key={key}>
                <dt className="font-semibold">{label}</dt>
                <dd className="wrap-break-word">
                  {before && (
                    <>
                      <span className="text-slate-500">
                        {display(before[key], key)}
                      </span>{" "}
                      →{" "}
                    </>
                  )}
                  {display(after[key], key)}
                </dd>
              </div>
            ))}
        </dl>
      )}
    </details>
  );
}
export default function AdminShopLocations() {
  const [store] = useState(createAdminShopLocationsStore);
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
  const locked =
    state.initialising || state.saving || state.denied || !state.accountId;
  const detail = state.conflict ? null : state.detail;
  const draft = state.draft,
    fields = draft?.details;
  const required: (keyof ShopLocationDetails)[] = [
    "storeCode",
    "name",
    "address1",
    "suburb",
    "state",
    "postcode",
  ];
  const valid =
    !!draft &&
    required.every(
      (key) =>
        typeof draft.details[key] === "string" &&
        String(draft.details[key]).trim(),
    ) &&
    states.includes(draft.details.state ?? "") &&
    /^[0-9]{4}$/.test(draft.details.postcode ?? "") &&
    draft.sourceReference.trim().length > 0 &&
    draft.evidence.trim().length > 0 &&
    draft.confirmed;
  const action =
    state.selectedId === null
      ? fields?.isActive
        ? "Create verified branch"
        : "Create retired branch"
      : !fields?.isActive
        ? "Retire reviewed branch"
        : detail?.branch.isActive === false
          ? "Reactivate reviewed branch"
          : "Save reviewed changes";
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 text-slate-900 sm:p-6">
      <nav
        aria-label="Administration"
        className="flex flex-wrap gap-5 text-sm font-semibold text-primary-700 underline"
      >
        <Link href="/admin">Account administration</Link>
        <Link href="/admin/health">Retailer health</Link>
        <Link href="/admin/product-alternatives">
          Product alternative reviews
        </Link>
        <Link href="/">MyShoppingList / sign in</Link>
      </nav>
      <h1 className="text-3xl font-semibold">Branch administration</h1>
      <p className="max-w-3xl text-sm leading-6 text-slate-600">
        Maintain manually verified branch details and retain the source and
        review history. Branch-specific price collection is unavailable. A
        directory entry does not verify product prices at that branch.
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
      {state.initialising && (
        <p role="status">Checking administrator access…</p>
      )}
      {state.saving && <p role="status">Saving reviewed branch…</p>}
      {!state.accountId && !state.initialising && (
        <button
          type="button"
          className={button}
          onClick={() => void state.initialise()}
        >
          Retry access check
        </button>
      )}
      {state.accountId && !state.denied && (
        <>
          <section
            aria-label="Find branches"
            className="rounded-xl border border-slate-200 bg-slate-50 p-5"
          >
            <h2 className="text-xl font-semibold">Find branches</h2>
            <form
              className="mt-4 grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void state.search();
              }}
            >
              <label className="font-semibold">
                Filter retailer
                <select
                  aria-label="Filter retailer"
                  className={input}
                  disabled={locked}
                  value={state.filterShopId ?? ""}
                  onChange={(event) =>
                    state.setFilters(
                      event.target.value ? Number(event.target.value) : null,
                      state.query,
                    )
                  }
                >
                  <option value="">All retailers</option>
                  {state.retailers.map((shop) => (
                    <option key={shop.id} value={shop.id}>
                      {shop.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="font-semibold">
                Branch search
                <input
                  className={input}
                  maxLength={100}
                  disabled={locked}
                  value={state.query}
                  placeholder="Name, suburb or postcode"
                  onChange={(event) =>
                    state.setFilters(state.filterShopId, event.target.value)
                  }
                />
              </label>
              <p className="text-xs text-slate-600 sm:col-span-2">
                Select a retailer or enter at least two search characters.
                Results include active, retired and unverified records.
              </p>
              <div className="flex flex-wrap gap-3 sm:col-span-2">
                <button
                  className={button}
                  disabled={
                    locked ||
                    state.searching ||
                    state.query.trim().length === 1 ||
                    (state.filterShopId === null &&
                      state.query.trim().length < 2)
                  }
                >
                  {state.searching ? "Searching…" : "Search branches"}
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={locked}
                  onClick={() => state.newBranch()}
                >
                  Add branch
                </button>
              </div>
            </form>
            {state.result && (
              <div className="mt-5">
                {!state.result.items.length && (
                  <p>
                    No branches found. Refine the search or add a verified
                    branch.
                  </p>
                )}
                {state.result.hasMore && (
                  <p className="mb-3 text-sm text-amber-900">
                    Showing the first 50 matches. Refine your search to find the
                    branch.
                  </p>
                )}
                <ul className="grid gap-3 sm:grid-cols-2">
                  {state.result.items.map((branch) => (
                    <li key={branch.location.id}>
                      <button
                        type="button"
                        className={`${button} h-full w-full bg-white text-left wrap-break-word`}
                        disabled={locked}
                        onClick={() => void state.edit(branch.location.id)}
                      >
                        <span className="block">{branch.location.name}</span>
                        <span className="mt-1 block text-sm font-normal">
                          {branch.location.shopName} ·{" "}
                          {[branch.location.suburb, branch.location.postcode]
                            .filter(Boolean)
                            .join(" ")}{" "}
                          · ID {branch.location.id}
                        </span>
                        <span className="mt-1 block text-xs font-normal">
                          {!branch.isActive
                            ? "Retired"
                            : branch.location.verifiedAt
                              ? "Active"
                              : "Unverified — hidden from customers"}{" "}
                          · Last verified: {date(branch.location.verifiedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          {state.loading && (
            <p role="status">Loading branch and review history…</p>
          )}
          {state.selectedId !== null && !state.loading && (
            <button
              type="button"
              className={button}
              disabled={locked}
              onClick={() => void state.edit(state.selectedId!)}
            >
              Reload branch
            </button>
          )}
          {state.conflict && (
            <p className="text-sm text-amber-900">
              Reload the branch and review the current details again. The
              previous confirmation has been cleared.
            </p>
          )}
          {draft && fields && (
            <section
              aria-label="Branch editor"
              className="rounded-xl border border-slate-200 bg-white p-5"
            >
              <h2 className="text-xl font-semibold">
                {state.selectedId === null
                  ? "Add a verified branch"
                  : `Review branch ${state.selectedId}`}
              </h2>
              {detail && (
                <p className="mt-2 text-sm text-slate-600">
                  Current record:{" "}
                  {!detail.branch.isActive
                    ? "Retired"
                    : detail.branch.location.verifiedAt
                      ? "Active and verified"
                      : "Unverified — hidden from customers"}
                  . Last verified: {date(detail.branch.location.verifiedAt)}
                </p>
              )}
              <form
                className="mt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void state.save();
                }}
              >
                <fieldset
                  disabled={locked || state.conflict}
                  className="space-y-4 disabled:opacity-60"
                >
                  <legend className="sr-only">
                    Branch details and review evidence
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="font-semibold">
                      Retailer
                      <select
                        aria-label="Retailer"
                        className={input}
                        disabled={state.selectedId !== null}
                        value={fields.shopId}
                        onChange={(event) =>
                          state.setField("shopId", Number(event.target.value))
                        }
                      >
                        {!state.retailers.some(
                          (shop) => shop.id === fields.shopId,
                        ) && (
                          <option value={fields.shopId}>
                            {detail?.branch.location.shopName ??
                              "Unavailable retailer"}{" "}
                            (inactive)
                          </option>
                        )}
                        {state.retailers.map((shop) => (
                          <option key={shop.id} value={shop.id}>
                            {shop.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="font-semibold">
                      Retailer branch code
                      <input
                        className={input}
                        required
                        maxLength={100}
                        readOnly={
                          state.selectedId !== null &&
                          detail?.branch.location.storeCode !== null
                        }
                        value={fields.storeCode ?? ""}
                        onChange={(event) =>
                          state.setField("storeCode", event.target.value)
                        }
                      />
                    </label>
                    {(
                      [
                        ["name", "Branch name", 200],
                        ["address1", "Street address", 300],
                        ["address2", "Additional address (optional)", 300],
                        ["suburb", "Suburb", 100],
                      ] as const
                    ).map(([key, label, length]) => (
                      <label key={key} className="font-semibold">
                        {label}
                        <input
                          className={input}
                          required={key !== "address2"}
                          maxLength={length}
                          value={fields[key] ?? ""}
                          onChange={(event) =>
                            state.setField(key, event.target.value)
                          }
                        />
                      </label>
                    ))}
                    <label className="font-semibold">
                      State or territory
                      <select
                        aria-label="State or territory"
                        className={input}
                        required
                        value={fields.state ?? ""}
                        onChange={(event) =>
                          state.setField("state", event.target.value)
                        }
                      >
                        <option value="">Select state or territory</option>
                        {states.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label className="font-semibold">
                      Postcode
                      <input
                        className={input}
                        required
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        maxLength={4}
                        value={fields.postcode ?? ""}
                        onChange={(event) =>
                          state.setField("postcode", event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <p className="text-xs text-slate-600">
                    Use the retailer’s stable branch code from a trustworthy
                    source. Retailer and existing branch code identify this
                    record. To replace an incorrect identity, retire it and
                    create a corrected record; existing prices stay linked to
                    their original record.
                  </p>
                  <label className="flex min-h-11 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-5 shrink-0"
                      checked={fields.isActive}
                      onChange={(event) =>
                        state.setField("isActive", event.target.checked)
                      }
                    />
                    Active branch
                  </label>
                  <p className="text-sm text-slate-600">
                    {fields.isActive
                      ? "After review, an active verified branch can appear in customer branch searches. This does not enable branch-specific pricing."
                      : "A retired branch is hidden from customer searches. Its identity, prices and review history are preserved."}
                  </p>
                  <label className="block font-semibold">
                    Verification source reference
                    <input
                      className={input}
                      required
                      maxLength={1000}
                      value={draft.sourceReference}
                      placeholder="Official branch page or authorised directory reference"
                      onChange={(event) => state.setSource(event.target.value)}
                    />
                  </label>
                  <label className="block font-semibold">
                    Verification evidence or change reason
                    <textarea
                      className={input}
                      rows={4}
                      required
                      maxLength={2000}
                      value={draft.evidence}
                      onChange={(event) =>
                        state.setEvidence(event.target.value)
                      }
                    />
                  </label>
                  <p className="text-xs text-slate-600">
                    Record what you checked, including operating status. Source
                    references and review evidence are visible only to
                    administrators. Do not include customer information.
                  </p>
                  <label className="flex min-h-11 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-5 shrink-0"
                      checked={draft.confirmed}
                      onChange={(event) =>
                        state.setConfirmed(event.target.checked)
                      }
                    />
                    I checked the branch address, retailer code and operating
                    status against the source.
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className={`${button} bg-primary-700 hover:bg-primary-800 active:bg-primary-800 text-white`}
                      disabled={!valid}
                    >
                      {action}
                    </button>
                    <button
                      type="button"
                      className={button}
                      onClick={() => state.closeEditor()}
                    >
                      Discard draft
                    </button>
                  </div>
                </fieldset>
              </form>
            </section>
          )}
          {detail && (
            <section
              aria-label="Branch review history"
              className="rounded-xl border border-slate-200 p-5"
            >
              <h2 className="text-xl font-semibold">Branch review history</h2>
              <p className="mt-2 text-xs text-slate-600">
                Newest first. Up to 100 previous reviews are shown.
              </p>
              {!detail.reviews.length && (
                <p className="mt-3">
                  No recorded reviews. Existing details have not been verified
                  through this directory.
                </p>
              )}
              <ol className="mt-3 space-y-4">
                {detail.reviews.map((review) => (
                  <li
                    key={review.id}
                    className="border-t border-slate-200 pt-3 text-sm"
                  >
                    <p className="font-semibold">
                      {review.action} · Review {review.id}
                    </p>
                    <p className="mt-1 text-slate-600">
                      {date(review.reviewedAt)} · Reviewer account{" "}
                      {review.reviewerAccountId}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap wrap-break-word">
                      {review.evidence}
                    </p>
                    <p className="mt-2 wrap-break-word">
                      Source: {review.sourceReference}
                    </p>
                    <RecordedChanges review={review} />
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </main>
  );
}
