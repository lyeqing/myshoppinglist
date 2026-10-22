import type { PlanningBasket, ShoppingListPlan } from "@/lib/api-types";

export const money = (value: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(
    value,
  );

function Basket({
  basket,
  count,
  lowest,
}: {
  basket: PlanningBasket;
  count: number;
  lowest: boolean;
}) {
  const incomplete = basket.missingItems.length > 0;
  return (
    <div
      className={`min-w-0 rounded-xl border p-4 ${incomplete ? "border-red-200 bg-red-50" : lowest ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
    >
      <h3 className="text-sm font-semibold">
        {lowest ? basket.name : `Only ${basket.name}`}
      </h3>
      <p
        className={`mt-2 text-2xl font-bold ${incomplete ? "text-red-900" : lowest ? "text-emerald-800" : "text-slate-900"}`}
      >
        {money(basket.subtotal)}
        {incomplete && (
          <span className="ml-2 text-sm font-normal">subtotal</span>
        )}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {basket.pricedCount} of {count} {count === 1 ? "item" : "items"} priced
        · includes quantities
      </p>
      {!!basket.needsChoiceCount && <p className="mt-2 text-sm font-semibold">Subtotal — {basket.needsChoiceCount} {basket.needsChoiceCount === 1 ? "item needs a choice" : "items need a choice"}</p>}
      {!!basket.substitutionCount && <p className="mt-1 text-xs">Includes {basket.substitutionCount} chosen {basket.substitutionCount === 1 ? "alternative" : "alternatives"}</p>}
      {incomplete && (
        <details className="mt-3 text-sm text-red-900">
          <summary className="cursor-pointer font-semibold">
            {basket.missingItems.length}{" "}
            {basket.missingItems.length === 1
              ? "item missing a price"
              : "items missing prices"}
          </summary>
          <ul className="mt-2 space-y-2">
            {basket.missingItems.map((item) => (
              <li key={item.itemId}>
                <a className="underline" href={`#list-item-${item.itemId}`}>
                  {item.name.replace(/\s*\|\s*/g, " · ")}
                </a>
                <span className="block text-xs">{item.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function ShoppingListCostSummary({
  plan,
}: {
  plan: ShoppingListPlan;
}) {
  if (!plan.items.length) return null;
  return (
    <section aria-label="Shopping cost summary" className="mb-5">
      <div className="grid gap-3 lg:grid-cols-3">
        <Basket basket={plan.lowest} count={plan.items.length} lowest />
        {plan.retailers.map((basket) => (
          <Basket
            key={basket.shopId}
            basket={basket}
            count={plan.items.length}
            lowest={false}
          />
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Estimated from current observed prices, including alternatives you explicitly choose. Different brands and package sizes can change what you buy. Lowest
        total may require visiting more than one shop. Your store’s prices and
        availability may differ. Totals use requested package counts and eligible multibuy offers. Stale
        prices and unverified conditional prices are excluded from totals.
      </p>
    </section>
  );
}
