import { useEffect, useState } from "react";
import type { PriceRefreshResult } from "./api-types";

export function checkedToday(date: string | null, now: number | null): boolean {
  if (!date || now === null) return false;
  const value = new Date(date);
  return (
    Number.isFinite(value.getTime()) &&
    value.getTime() <= now &&
    value.toDateString() === new Date(now).toDateString()
  );
}

export function priceAge(
  date: string | null,
  usable: boolean,
  now: number | null,
): string {
  if (!date || now === null) return "Price check date unavailable";
  const value = new Date(date);
  if (!Number.isFinite(value.getTime()) || value.getTime() > now)
    return "Price check date unverified";
  if (usable && checkedToday(date, now)) return "Price up to date";
  return `${usable ? "Price last checked" : "Last checked"} ${value.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;
}

// Local midnight and returning to a tab must update labels without another retailer request.
export function usePriceNow(checkVersion?: unknown) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [checkVersion]);
  return now;
}

export type RefreshPrice = {
  checkedDate: string | null;
  price: number | null;
  status: string;
  refreshStatus?: string | null;
};
export const pricePending = (price: RefreshPrice) =>
  ["Waiting", "Updating", "Paused"].includes(price.refreshStatus ?? "");
export const priceCurrent = (price: RefreshPrice, now: number | null) =>
  price.price !== null &&
  price.status === "Fresh" &&
  checkedToday(price.checkedDate, now);
export function refreshProgress(
  rows: {
    item: { isPurchased: boolean; isHidden: boolean };
    prices: RefreshPrice[];
  }[],
  shopIds: number[],
  now: number | null,
) {
  const remaining = rows.filter((r) => !r.item.isPurchased && !r.item.isHidden);
  if (!remaining.length) return "No remaining items to refresh.";
  if (now === null) return "Checking price dates…";
  const prices = remaining.flatMap((r) => r.prices);
  const missing = remaining.reduce(
    (total, r) => total + Math.max(0, shopIds.length - r.prices.length),
    0,
  );
  const pending = prices.filter(pricePending).length;
  const failed = prices.filter((p) => p.refreshStatus === "RetryLater").length;
  const need = prices.filter((p) => !priceCurrent(p, now)).length + missing;
  if (!prices.length)
    return "No verified retailer prices yet. Use comparison retry where available.";
  if (!need && !pending && !failed) return "All prices up to date";
  return [
    pending ? `${pending} price check${pending === 1 ? "" : "s"} pending.` : "",
    need
      ? `${need} price${need === 1 ? " needs" : "s need"} checking or ${need === 1 ? "is" : "are"} unavailable.`
      : "",
    failed
      ? `${failed} price check${failed === 1 ? "" : "s"} unsuccessful. Previous prices are retained.`
      : "",
    missing
      ? "Some retailer matches are missing; price refresh checks known products only."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
export function refreshNotice(result: PriceRefreshResult): string {
  return (
    [
      result.queued
        ? `${result.queued} price check${result.queued === 1 ? "" : "s"} queued.`
        : "",
      result.alreadyRunning ? `${result.alreadyRunning} already running.` : "",
      result.deferred
        ? `${result.deferred} deferred. Refresh is unavailable or a retry limit applies; please try later.`
        : "",
      result.current ? `${result.current} already checked today.` : "",
    ]
      .filter(Boolean)
      .join(" ") ||
    "No eligible retailer prices to refresh. Price refresh checks known products still to buy."
  );
}
export function refreshLabel(status?: string | null): string | null {
  if (status === "Waiting")
    return "Waiting for price update — an online extension will check this product.";
  if (status === "Updating") return "Updating price…";
  if (status === "Paused")
    return "Retailer checks paused temporarily. Your price update is queued.";
  if (status === "RetryLater")
    return "Price update unsuccessful. We’ll retry later.";
  return null;
}
