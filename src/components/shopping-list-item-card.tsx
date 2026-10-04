"use client";

import { useState } from "react";
import type {
  ListItem,
  ListItemUpdate,
  PlanningItem,
  PlanningPrice,
} from "@/lib/api-types";
import { ApiError } from "@/lib/api-client";
import { money } from "./shopping-list-cost-summary";

function safeLink(value: string | null) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function PriceDetail({
  price,
  quantity,
  primary = false,
}: {
  price: PlanningPrice;
  quantity: number;
  primary?: boolean;
}) {
  const link = safeLink(price.productUrl);
  return (
    <div className="text-sm text-slate-500">
      <p>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {primary ? `View at ${price.shopName}` : price.shopName}
          </a>
        ) : (
          price.shopName
        )}
        {!primary && ": "}
        {!primary &&
          (price.price !== null ? (
            <>
              {money(price.price * quantity)} total · {money(price.price)} each
            </>
          ) : (
            "No price available"
          ))}
        {!price.includedInTotal && (
          <span className="ml-2 text-amber-800">— {price.status}</span>
        )}
      </p>
      {price.specialDescription && (
        <p className="mt-1 text-xs">{price.specialDescription}</p>
      )}
      {price.refreshStatus && (
        <p role="status" className="mt-1 text-xs text-sky-700">
          {price.refreshStatus === "Waiting"
            ? "Waiting for price update — an online extension will check this product."
            : price.refreshStatus === "Updating"
              ? "Updating price…"
              : "Price update unsuccessful. We’ll retry later."}
        </p>
      )}
      {price.checkedDate && (
        <p className="mt-1 text-xs">
          Checked{" "}
          {new Date(price.checkedDate).toLocaleString("en-AU", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}

export default function ShoppingListItemCard({
  row,
  disabled,
  checking,
  save,
  remove,
  reload,
}: {
  row: PlanningItem;
  disabled: boolean;
  checking: boolean;
  save: (id: number, edit: ListItemUpdate) => Promise<ListItem>;
  remove: (id: number, expectedUpdatedDate: string) => Promise<void>;
  reload: (id: number) => Promise<ListItem | null>;
}) {
  const { item, prices } = row;
  const [draft, setDraft] = useState<{ notes: string; version: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = busy || disabled;
  const best = prices
    .filter((p) => p.includedInTotal && p.price !== null)
    .sort((a, b) => a.price! - b.price!)[0];
  const ties = best
    ? prices.filter((p) => p.includedInTotal && p.price === best.price)
    : [];
  const title = item.product.name.replace(/\s*\|\s*/g, " · ");
  const pack =
    item.product.packSize && item.product.packUnit
      ? `${item.product.packQuantity && item.product.packQuantity > 1 ? item.product.packQuantity + " × " : ""}${item.product.packSize}${item.product.packUnit}`
      : null;

  async function act(action: () => Promise<void>) {
    if (locked) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setConflict(e instanceof ApiError && e.status === 409);
      setError(
        e instanceof Error ? e.message : "Unable to save. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function quantity(value: number) {
    await act(async () => {
      const saved = await save(item.id, {
        quantity: value,
        notes: item.notes,
        isPurchased: item.isPurchased,
        isHidden: item.isHidden,
        expectedUpdatedDate: item.updatedDate,
      });
      // Our own quantity edit should not conflict with a note draft based on this version.
      setDraft((previous) =>
        previous?.version === item.updatedDate
          ? { ...previous, version: saved.updatedDate }
          : previous,
      );
      setNotice("Quantity saved.");
    });
  }
  async function saveNote() {
    if (!draft) return;
    await act(async () => {
      await save(item.id, {
        quantity: item.quantity,
        notes: draft.notes || null,
        isPurchased: item.isPurchased,
        isHidden: item.isHidden,
        expectedUpdatedDate: draft.version,
      });
      setDraft(null);
      setConflict(false);
      setNotice("Note saved.");
    });
  }
  async function refresh() {
    await act(async () => {
      const latest = await reload(item.id);
      if (!latest) throw new Error("This item is no longer available.");
      setDraft((previous) =>
        previous
          ? { notes: latest.notes ?? "", version: latest.updatedDate }
          : null,
      );
      setConflict(false);
      setNotice("Latest saved version loaded.");
    });
  }
  const button =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50";
  return (
    <article
      id={`list-item-${item.id}`}
      aria-label={title}
      className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start gap-4">
        {safeLink(item.product.imageUrl) && (
          // Retailer image URLs are stored externally; avoid requiring an image proxy.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={safeLink(item.product.imageUrl)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-16 w-16 shrink-0 rounded-lg object-contain"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="wrap-break-word font-semibold text-slate-900">
            {title}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {[item.product.brand, pack].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className="mt-4">
        {best ? (
          <div className="rounded-xl bg-emerald-50 p-4">
            <p className="text-xl font-bold text-emerald-900">
              {money(best.price! * item.quantity)}{" "}
              <span className="text-base font-semibold">
                at {ties.map((p) => p.shopName).join(" & ")}
              </span>
            </p>
            <p className="mt-1 text-sm text-emerald-800">
              {money(best.price!)} each · Total for {item.quantity} · Lowest
              observed price
            </p>
            <div className="mt-2">
              <PriceDetail price={best} quantity={item.quantity} primary />
            </div>
          </div>
        ) : (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            No current comparable price available.
          </p>
        )}
        <div className="mt-3 space-y-3">
          {prices
            .filter((p) => p !== best)
            .map((price) => (
              <PriceDetail
                key={price.shopId}
                price={price}
                quantity={item.quantity}
              />
            ))}
        </div>
        {checking && (
          <p role="status" className="mt-3 text-sm text-sky-700">
            Checking other shops… Prices will update here.
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <div
          className="flex items-center gap-3"
          role="group"
          aria-label="Quantity"
        >
          <span className="text-sm text-slate-600">Qty</span>
          <button
            className={button}
            aria-label="Decrease quantity"
            disabled={locked || conflict || item.quantity <= 1}
            onClick={() => void quantity(item.quantity - 1)}
          >
            −
          </button>
          <output
            aria-label="Item quantity"
            className="min-w-6 text-center font-semibold"
          >
            {item.quantity}
          </output>
          <button
            className={button}
            aria-label="Increase quantity"
            disabled={locked || conflict || item.quantity >= 2147483647}
            onClick={() => void quantity(item.quantity + 1)}
          >
            +
          </button>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {!draft && (
            <button
              className="font-semibold text-sky-700 disabled:opacity-50"
              disabled={locked}
              onClick={() =>
                setDraft({ notes: item.notes ?? "", version: item.updatedDate })
              }
            >
              {item.notes ? "Edit note" : "Add note"}
            </button>
          )}
          <button
            className="font-semibold text-red-700 disabled:opacity-50"
            disabled={locked}
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        </div>
      </div>
      {item.notes && !draft && (
        <p className="mt-3 whitespace-pre-wrap wrap-break-word text-sm text-slate-600">
          {item.notes}
        </p>
      )}
      {draft && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveNote();
          }}
        >
          <label className="block text-sm">
            Notes
            <textarea
              aria-label="Notes"
              disabled={locked}
              maxLength={4000}
              rows={2}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          {draft.version !== item.updatedDate && (
            <p className="text-sm text-amber-800">
              This item has changed. Your draft is kept. Load the latest saved
              version before saving.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              className={button}
              disabled={
                locked || conflict || draft.version !== item.updatedDate
              }
            >
              Save note
            </button>
            <button
              type="button"
              className={button}
              disabled={locked}
              onClick={() => {
                setDraft(null);
                setConflict(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {(conflict || (draft && draft.version !== item.updatedDate)) && (
        <button
          className={`${button} mt-3`}
          disabled={locked}
          onClick={() => void refresh()}
        >
          Load latest saved version
        </button>
      )}
      {confirmDelete && (
        <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900">
          <p>Remove this item from your shopping list?</p>
          <div className="mt-2 flex gap-3">
            <button
              className={button}
              disabled={locked}
              onClick={() => void act(() => remove(item.id, item.updatedDate))}
            >
              Delete item
            </button>
            <button
              className={button}
              disabled={locked}
              onClick={() => setConfirmDelete(false)}
            >
              Keep item
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-amber-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-xs text-slate-500">
          {notice}
        </p>
      )}
    </article>
  );
}
