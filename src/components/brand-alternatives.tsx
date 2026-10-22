"use client";

import PriceObservationContextPanel from "./price-observation-context";
import Link from "next/link";
import type { BrandAlternative, PackComparisonPrice } from "@/lib/api-types";
import { priceAge, usePriceNow } from "@/lib/price-age";
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

export default function BrandAlternatives({
  alternatives,
}: {
  alternatives?: BrandAlternative[] | null;
}) {
  const now = usePriceNow(alternatives);
  if (!alternatives?.length) return null;
  return (
    <section
      aria-label="Alternative brands"
      className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-900"
    >
      <h4 className="font-semibold">Alternative brands</h4>
      <p className="mt-1 text-xs text-slate-600">
        Reviewed alternatives and automatic suggestions from saved prices. Taste, ingredients
        and quality may differ. Automatic suggestions have not been reviewed for suitability; check the product details for your needs. These
        options do not change your list or basket totals.
      </p>
      <ul className="mt-3 space-y-4">
        {alternatives.map((alternative) => {
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
                    Your original product — lowest current saved package price
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
