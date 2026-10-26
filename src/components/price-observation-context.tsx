import type { PriceObservationContext } from "@/lib/api-types";

function sourceLabel(source?: string) {
  switch (source) {
    case "StructuredData":
    case "RetailerPage":
    case "RetailerEndpoint":
    case "Playwright":
      return "Retailer website";
    case "BrowserExtension":
      return "Chrome extension";
    case "Manual":
      return "Manually recorded";
    default:
      return "Source unavailable";
  }
}

function coverageLabel(scope?: string) {
  switch (scope) {
    case "Online":
      return "Online price";
    case "National":
      return "National price";
    case "InStore":
      return "In-store price";
    case "Catalogue":
      return "Catalogue price";
    case "StoreSpecific":
      return "Branch-specific price";
    default:
      return "Coverage unknown — estimate";
  }
}

function sourceLink(value?: string | null) {
  if (!value || value.length > 2048 || /[\s\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    // Keep the backend's public-product-route policy at the rendering boundary.
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      value.split("://")[1]?.split(/[/?#]/)[0].includes("@")
    )
      return undefined;
    const coles =
      ["coles.com.au", "www.coles.com.au"].includes(url.hostname) &&
      /^\/product\/[a-zA-Z0-9-]+\/?$/.test(url.pathname);
    const woolworths =
      ["woolworths.com.au", "www.woolworths.com.au"].includes(url.hostname) &&
      /^\/shop\/productdetails\/[0-9]+(?:\/[a-zA-Z0-9-]+)?\/?$/.test(
        url.pathname
      );
    if (!coles && !woolworths) return undefined;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

export default function PriceObservationContextPanel({
  observation,
  hasPrice,
  shopName,
}: {
  observation?: PriceObservationContext | null;
  hasPrice: boolean;
  shopName: string;
}) {
  if (!observation && !hasPrice) return null;
  const link = sourceLink(observation?.sourceUrl);
  return (
    <span className="mt-1 block text-xs text-slate-600 wrap-anywhere">
      <span className="block">
        Source: {sourceLabel(observation?.sourceType)} ·{" "}
        {coverageLabel(observation?.priceScope)}
      </span>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center py-2 font-semibold text-sky-700 underline underline-offset-2"
        >
          View price source
          <span className="sr-only"> at {shopName} (opens in a new tab)</span>
        </a>
      )}
    </span>
  );
}
