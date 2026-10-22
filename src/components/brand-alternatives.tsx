"use client";

import PriceObservationContextPanel from "./price-observation-context";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { BrandAlternative, PackComparisonPrice, ListItem, ShoppingListSubstitutionChoice } from "@/lib/api-types";
import { priceAge, priceCurrent, usePriceNow } from "@/lib/price-age";
import { money } from "./shopping-list-cost-summary";

const number = (value: number) =>
  value.toLocaleString("en-AU", { maximumFractionDigits: 2 });

function retailerLink(value: string | null) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        "www.coles.com.au",
        "coles.com.au",
        "www.woolworths.com.au",
        "woolworths.com.au",
      ].includes(url.hostname)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function Price({
  value,
  unit,
  now,
}: {
  value: PackComparisonPrice;
  unit: string;
  now: number | null;
}) {
  return (
    <div className="text-sm">
      <p>
        {value.shopName}:{" "}
        {value.price !== null
          ? `${money(value.price)} per package`
          : "Price unavailable"}
        {value.unitPrice !== null && (
          <>
            {" "}
            · {money(value.unitPrice)} per{" "}
            <span className="whitespace-nowrap">100 {unit}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {priceAge(value.checkedDate, value.status === "Fresh", now)}
        {value.status !== "Fresh" && <> · {value.status}</>}
      </p>
      <PriceObservationContextPanel
        observation={value.observation}
        hasPrice={value.price !== null || value.checkedDate !== null}
        shopName={value.shopName}
      />
    </div>
  );
}

type Props = {
  alternatives?: BrandAlternative[] | null;
  choices?: ShoppingListSubstitutionChoice[] | null;
  item?: ListItem;
  accountId?: number;
  selectedShopId?: number | null;
  disabled?: boolean;
  onChanged?: () => Promise<unknown>;
};
export default function BrandAlternatives(props: Props) {
  return <AlternativeChoices key={`${props.accountId}-${props.item?.id}`} {...props} />;
}
function AlternativeChoices({ alternatives, choices, item, accountId, selectedShopId, disabled, onChanged }: Props) {
  const now = usePriceNow([alternatives, choices]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const changed = () => { alive.current = false; request.current?.abort(); };
    window.addEventListener("myshoppinglist-session-changed", changed);
    return () => { changed(); window.removeEventListener("myshoppinglist-session-changed", changed); };
  }, []);
  const visible = (alternatives ?? []).filter(a => !selectedShopId || a.offer.shopId === selectedShopId);
  const saved = (choices ?? []).filter(c => !selectedShopId || c.shopId === selectedShopId);
  const canEdit = !!accountId && !!item && !!onChanged;
  async function choose(shopId: number, productId: number | null, quantity: number) {
    if (!canEdit || !item || !accountId || busy || disabled || !alive.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setNotice(""); setReloadNeeded(false);
    let persisted = false;
    try {
      await api<void>(`/shopping-lists/${item.shoppingListId}/items/${item.id}/substitutions/${shopId}`, {
        method: "PUT", signal: controller.signal,
        body: JSON.stringify({ expectedAccountId: accountId, alternativeProductId: productId, quantity, expectedUpdatedDate: item.updatedDate }),
      });
      persisted = true;
      if (!alive.current) return;
      await onChanged?.();
      if (alive.current) setNotice(productId === null ? "Choice undone. The original product is kept." : "Alternative saved for this store. Its package quantity is included in the subtotal.");
    } catch (e) {
      if (controller.signal.aborted || !alive.current) return;
      setError(persisted ? "Choice saved, but prices could not reload. Reload your list before continuing." : e instanceof Error ? e.message : "Unable to save this choice.");
      setReloadNeeded(persisted || e instanceof ApiError && e.status === 409);
    } finally { if (alive.current) setBusy(false); }
  }
  if (!visible.length && !saved.length) return null;
  return (
    <section
      aria-label="Alternative brands"
      className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-900"
    >
      <h4 className="font-semibold">Alternative brands</h4>
      <p className="mt-1 text-xs text-slate-600">
        Reviewed alternatives and automatic suggestions from saved prices. Taste, ingredients
        and quality may differ. Automatic suggestions have not been reviewed for suitability; check the product details for your needs. These
        options only enter a store’s subtotal after you choose one. Your original product stays saved.
      </p>
      {saved.map(choice => <div key={choice.shopId} className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
        <p className="font-semibold">Chosen for {choice.shopName}: {choice.product.name}</p>
        <p className="mt-1 text-sm">{choice.quantity} {choice.quantity === 1 ? "package" : "packages"} · {choice.status === "Fresh" ? "Included in this store’s subtotal" : `${choice.status} — excluded from subtotal`}</p>
        {choice.status !== "Fresh" && <p className="mt-1 text-xs">Review the product and its current price before choosing again.</p>}
        {canEdit && <button type="button" disabled={disabled || busy} onClick={() => void choose(choice.shopId, null, choice.quantity)} className="mt-2 min-h-11 font-semibold text-sky-800 underline disabled:opacity-50">Undo choice for {choice.shopName}</button>}
      </div>)}
      <ul className="mt-3 space-y-4">
        {visible.map((alternative) => {
          const { product, offer, original } = alternative;
          const link = retailerLink(offer.productUrl);
          const difference = alternative.unitPriceDifferencePercent;
          const upfront = alternative.packagePriceDifference;
          const canCompare =
            original?.status === "Fresh" &&
            offer.status === "Fresh" &&
            difference !== null &&
            Number.isFinite(difference) &&
            offer.price !== null &&
            original.price !== null &&
            offer.unitPrice !== null &&
            original.unitPrice !== null;
          return (
            <li
              key={`${product.id}-${offer.shopId}`}
              className="border-t border-slate-100 pt-3"
            >
              <p className="text-xs font-semibold text-sky-800">
                {alternative.label}
              </p>
              <p className="mt-1 wrap-break-word font-medium">{product.name}</p>
              {product.brand && (
                <p className="mt-1 text-sm text-slate-600">
                  Brand: {product.brand}
                </p>
              )}
              <p className="mt-1 text-sm">
                {number(alternative.totalQuantity)} {alternative.unit} total per
                package · {number(alternative.quantityRatio)} × your original
                package quantity
              </p>
              <div className="mt-2">
                <Price value={offer} unit={alternative.unit} now={now} />
              </div>
              {original && (
                <div className="mt-2 text-slate-600">
                  <p className="text-xs font-semibold">
                    Your original product — saved package price
                  </p>
                  <Price value={original} unit={alternative.unit} now={now} />
                </div>
              )}
              {canCompare ? (
                <p className="mt-2 text-sm font-semibold">
                  {difference === 0
                    ? "Same price per unit"
                    : `${number(Math.abs(difference!))}% ${difference! < 0 ? "less" : "more"} per 100 ${alternative.unit}`}
                  {upfront !== null &&
                    (upfront === 0
                      ? "; same package cost."
                      : `; costs ${money(Math.abs(upfront))} ${upfront > 0 ? "more" : "less"} per package.`)}
                </p>
              ) : (
                <p className="mt-2 text-xs text-slate-600">
                  A unit-price difference needs current comparable prices for
                  both products.
                </p>
              )}
              {alternative.quantityRatio > 1 && (
                <p className="mt-2 text-xs text-amber-900">
                  Larger package: consider how much you need, storage and
                  possible waste before buying.
                </p>
              )}
              {canEdit && item && !item.isPurchased && !item.isHidden && (
                <form key={`${product.id}-${offer.shopId}-${saved.find(c => c.shopId === offer.shopId)?.updatedDate ?? "new"}`} className="mt-3 rounded-lg bg-slate-50 p-3" onSubmit={event => {
                  event.preventDefault();
                  const quantity = Number(new FormData(event.currentTarget).get("quantity"));
                  if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 999) void choose(offer.shopId, product.id, quantity);
                }}>
                  <label className="block text-sm font-medium">
                    Packages of {product.name} at {offer.shopName}
                    <input name="quantity" aria-label={`Packages of ${product.name} at ${offer.shopName}`} type="number" min={1} max={999} step={1} required defaultValue={saved.find(c => c.shopId === offer.shopId && c.product.id === product.id)?.quantity ?? Math.min(item.quantity, 999)} disabled={disabled || busy || reloadNeeded} className="ml-2 min-h-11 w-24 rounded border border-slate-300 bg-white px-3" />
                  </label>
                  <p className="mt-2 text-xs">This is the number of alternative packages to buy, not an automatic size conversion.</p>
                  <button type="submit" disabled={disabled || busy || reloadNeeded || !priceCurrent(offer, now)} className="mt-2 min-h-11 rounded-lg bg-sky-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
                    {saved.some(c => c.shopId === offer.shopId && c.product.id === product.id) ? `Update choice for ${offer.shopName}` : `Use this alternative at ${offer.shopName}`}
                  </button>
                  {!priceCurrent(offer, now) && <p className="mt-1 text-xs">A current, comparable price is required to choose this alternative.</p>}
                </form>
              )}
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block min-h-11 py-2 text-sm font-semibold text-sky-700 underline"
                >
                  Check this alternative at {offer.shopName}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-sky-800">{notice}</p>}
      {reloadNeeded && <button type="button" disabled={busy || disabled} className="mt-2 min-h-11 font-semibold text-sky-800 underline" onClick={async () => {
        try { await onChanged?.(); if (alive.current) { setReloadNeeded(false); setError(""); } } catch { if (alive.current) setError("Unable to reload prices. Please try again."); }
      }}>Reload choices</button>}
      <p className="mt-3 text-xs text-slate-600">
        Single-package prices shown; buying several packages or qualifying for a
        multibuy can change your spending. Check the retailer for the latest
        price.
      </p>
      <Link
        href="/settings"
        className="mt-2 inline-block min-h-11 py-2 text-sm text-sky-700 underline"
      >
        Manage alternative-brand comparisons
      </Link>
    </section>
  );
}
