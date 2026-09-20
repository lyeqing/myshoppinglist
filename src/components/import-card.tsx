"use client";
import { useEffect, useState } from "react";
import type { Job, Price, RetailerState } from "@/lib/api-types";
import { isActive } from "@/lib/api-types";
import { bestKnownPrices, freshness, promotionWarning } from "@/lib/price-comparison";

export function Spinner() { return <span aria-hidden="true" className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />; }
const retailerLabels: Record<RetailerState, string> = { Pending: "Waiting to check", Checking: "Checking prices…", Exact: "Exact match", Likely: "Likely match", Possible: "Possible match", NotFound: "No match found", Unavailable: "Price unavailable", CheckFailed: "Unable to verify", NotSupported: "Comparison not available yet" };
const stateLabels = { Queued: "In the queue", Processing: "Finding your product", Completed: "Checked", Partial: "Added · some checks unavailable", Failed: "Couldn’t add product", Cancelled: "Import stopped" };
const time = (date: string) => Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "unknown time";
function amount(price: Pick<Price, "price" | "currency">) { try { return new Intl.NumberFormat("en-AU", { style: "currency", currency: price.currency, currencyDisplay: "code" }).format(price.price); } catch { return `${price.currency} ${price.price.toFixed(2)}`; } }
export default function ImportCard({ job, error, onRetry }: { job: Job; error?: string; onRetry: () => void }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [job]);
  const best = now === null ? [] : bestKnownPrices(job.retailers, now);
  const active = isActive(job);
  const product = job.product;
  const pack = product ? [product.packQuantity ? `${product.packQuantity} ×` : null, product.packSize && product.packUnit ? `${product.packSize}${product.packUnit}` : null].filter(Boolean).join(" ") : "";
  return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={product?.name ?? `Import ${job.jobId}`}>
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 text-xs">
      <span className="font-semibold tracking-wide text-slate-500">IMPORT #{job.jobId}</span>
      <span className={`flex items-center gap-2 text-right font-medium ${job.status === "Failed" ? "text-amber-800" : active ? "text-sky-700" : "text-emerald-800"}`}>
        {active && !error && <Spinner />}{error ? "Updates paused" : active && product ? "Checking other stores…" : stateLabels[job.status]}
      </span>
    </div>
    <div className="flex gap-4 p-5 sm:p-6">
      <div aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-2xl font-semibold text-sky-700">{product?.brand?.slice(0, 2).toUpperCase() ?? "↗"}</div>
      <div className="min-w-0 flex-1">
        <h3 className="wrap-break-word text-lg font-semibold tracking-tight">{product?.name ?? (job.status === "Failed" ? "We couldn’t identify this product" : active ? "Finding your product…" : "Import unavailable")}</h3>
        {product ? <p className="mt-1 text-sm text-slate-500">{[product.brand, pack].filter(Boolean).join(" · ") || "Product added to your list"}</p>
          : <p className="mt-1 text-sm leading-6 text-slate-500">{active ? "You can keep adding products while we check this link." : "Check the product link and submit it again when you’re ready."}</p>}
        <p className="mt-2 text-xs text-slate-500">Requested quantity: {job.quantity}{job.nextAttemptDate ? ` · Retrying after ${time(job.nextAttemptDate)}` : ""}</p>
      </div>
    </div>
    {error && <div className="mx-5 mb-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">{error} <button className="ml-1 font-semibold underline underline-offset-4" onClick={onRetry}>Retry updates</button></div>}
    {product && <div className="mx-5 mb-5 space-y-2 sm:mx-6">
      {best.map(group => <div key={`${group.currency}-${group.scope}`} className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">Best known price · {group.scope === "Online" ? "online" : "national"}</p>
        <p className="mt-1 text-lg font-semibold text-emerald-950">{amount(group)} <span className="text-sm font-medium">at {group.shopNames.join(" and ")}</span></p>
        <p className="mt-1 text-xs leading-5 text-emerald-900">Per product pack, among {group.retailerCount} retailers with comparable fresh prices. Confirm availability and final price with the retailer.</p>
      </div>)}
      {best.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">A best-known price needs fresh, exact matches from at least two retailers with comparable price coverage. Prices with unverified store coverage cannot be ranked.</p>}
    </div>}
    {job.retailers.length > 0 && <ul className="border-t border-slate-100 px-5 sm:px-6">
      {job.retailers.map(retailer => <li key={retailer.shopId} className="border-b border-slate-100 py-3 last:border-0">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-semibold">{retailer.shopName}</span>
          <span className={`text-right text-xs ${retailer.status === "Exact" ? "text-emerald-700" : "text-slate-500"}`}>{retailerLabels[retailer.status]}</span>
        </div>
        {retailer.status === "Likely" || retailer.status === "Possible" ? <p className="mt-1 text-xs text-amber-800">Identity needs confirmation · excluded from best-known prices.</p> : null}
        {retailer.errorCode === "no_verified_match_in_candidates" && <p className="mt-1 text-xs text-slate-500">No verified match among the products checked.</p>}
        {retailer.status === "Unavailable" && <p className="mt-1 text-xs text-slate-500">We couldn’t check a current price. Your product remains on the list.</p>}
        {retailer.status === "Exact" && retailer.prices.length === 0 && <p className="mt-1 text-xs text-slate-500">Product matched · no current price available.</p>}
        {retailer.prices.map((price, index) => <div key={`${price.currency}-${price.priceScope}-${price.shopLocationId}-${index}`} className="mt-2 rounded-xl bg-slate-50 px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-xl font-semibold tracking-tight text-slate-900">{amount(price)}</span><span className="text-xs text-slate-500">{price.priceScope === "Unknown" ? "Store not verified" : price.priceScope}{price.shopLocationId ? ` · Store #${price.shopLocationId}` : ""}</span></div>
          <p className="mt-1 text-xs text-slate-500">Observed {time(price.checkedDate)}{retailer.isFromCache ? " · Saved observation" : ""}</p>
          {now !== null && <p className={`mt-1 text-xs font-medium ${freshness(price.checkedDate, now) === "Fresh" ? "text-slate-600" : "text-amber-800"}`}>{freshness(price.checkedDate, now)}</p>}
          {price.specialDescription && <p className="mt-1 wrap-break-word text-xs text-emerald-800">{price.specialDescription}</p>}
          {now !== null && promotionWarning(price, now) && <p className="mt-1 text-xs text-amber-800">{promotionWarning(price, now)}</p>}
          {price.inStock === false && <p className="mt-1 text-xs text-amber-800">Reported out of stock</p>}
          {price.sourceUrl.startsWith("https://") && <a className="mt-2 inline-block text-xs font-medium text-sky-700 underline underline-offset-4" href={price.sourceUrl} target="_blank" rel="noopener noreferrer">View at {retailer.shopName} ↗</a>}
        </div>)}
      </li>)}
    </ul>}
  </article>;
}
