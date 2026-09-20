import type { Price, Retailer } from "./api-types";

export const FRESH_HOURS = 6;
export const STALE_HOURS = 24;
const HOUR = 60 * 60 * 1000;

export function freshness(checkedDate: string, now: number): string {
  const age = now - Date.parse(checkedDate);
  if (!Number.isFinite(age) || age < 0) return "Check time unverified";
  if (age <= FRESH_HOURS * HOUR) return "Fresh";
  return age <= STALE_HOURS * HOUR ? "Refresh recommended" : "Price may be stale";
}

export function promotionWarning(price: Price, now: number): string | null {
  const start = price.specialStartDate === null ? null : Date.parse(price.specialStartDate);
  const end = price.specialEndDate === null ? null : Date.parse(price.specialEndDate);
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))
    || (start !== null && end !== null && start > end)) return "Promotion dates unverified";
  if (end !== null && end <= now) return "Promotion ended · price needs checking";
  if (start !== null && start > now) return "Promotion has not started";
  if (/multi.?buy|member|loyalty|buy\s+\d/i.test(`${price.specialType ?? ""} ${price.specialDescription ?? ""}`))
    return "Conditional offer · check retailer terms";
  return null;
}

export function comparisonEligible(retailer: Retailer, price: Price, now: number): boolean {
  return retailer.status === "Exact" && retailer.matchType === "Exact"
    && freshness(price.checkedDate, now) === "Fresh"
    && Number.isFinite(price.price) && price.price >= 0 && /^[A-Z]{3}$/.test(price.currency)
    && price.shopLocationId === null && ["National", "Online"].includes(price.priceScope)
    && price.inStock !== false && promotionWarning(price, now) === null;
}

export interface BestKnownPrice {
  currency: string;
  scope: string;
  price: number;
  shopNames: string[];
  retailerCount: number;
}

// National and online observations form separate groups; store identifiers are retailer-specific.
export function bestKnownPrices(retailers: Retailer[], now: number): BestKnownPrice[] {
  const groups = new Map<string, { retailer: Retailer; price: Price }[]>();
  for (const retailer of retailers) for (const price of retailer.prices) {
    if (!comparisonEligible(retailer, price, now)) continue;
    const key = `${price.currency}:${price.priceScope}`;
    const group = groups.get(key) ?? [];
    group.push({ retailer, price }); groups.set(key, group);
  }
  return [...groups.values()].flatMap(group => {
    const retailerCount = new Set(group.map(item => item.retailer.shopId)).size;
    if (retailerCount < 2) return [];
    const minimum = Math.min(...group.map(item => item.price.price));
    return [{ currency: group[0].price.currency, scope: group[0].price.priceScope, price: minimum,
      shopNames: [...new Set(group.filter(item => item.price.price === minimum).map(item => item.retailer.shopName))], retailerCount }];
  });
}
