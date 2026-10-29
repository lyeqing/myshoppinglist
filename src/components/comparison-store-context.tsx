import Link from "next/link";
import type { ComparisonStoreContext } from "@/lib/api-types";

export default function ComparisonStoreContextPanel({
  context,
}: {
  context: ComparisonStoreContext;
}) {
  const branches = context.branches ?? [];
  const unavailable = branches.filter((branch) => !branch.isAvailable).length;
  const disabled = branches.filter(
    (branch) => !branch.supermarketEnabled,
  ).length;
  return (
    <section
      aria-label="Comparison stores and branches"
      className="mb-3 min-w-0 max-w-full space-y-2 text-sm text-slate-600 wrap-anywhere"
    >
      <p>
        {context.preferredOnly
          ? `Comparing My Stores: ${context.shopNames.join(", ") || "No active stores"}`
          : "Comparing all supported stores"}
        .{" "}
        <Link href="/settings" className="font-semibold text-primary-700 underline">
          Manage My Stores
        </Link>
      </p>
      {branches.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="font-semibold text-slate-800">
            Prices shown are not verified for your saved branches.
          </p>
          <p className="mt-1">
            Branch-specific price collection is unavailable. Saving a branch
            does not confirm prices or product availability there.
          </p>
          {(unavailable > 0 || disabled > 0) && (
            <p className="mt-2 text-amber-900">
              {unavailable > 0 &&
                `${unavailable} saved ${unavailable === 1 ? "branch is" : "branches are"} unavailable. `}
              {disabled > 0 &&
                `${disabled} saved ${disabled === 1 ? "branch belongs" : "branches belong"} to a supermarket that is not enabled in My Stores. `}
              Review your selections in My Stores.
            </p>
          )}
          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer py-3 font-semibold text-primary-700">
              Saved branches ({branches.length})
            </summary>
            <ul className="space-y-3 pt-1">
              {branches.map((branch) => (
                <li
                  key={branch.location.id}
                  className="border-t border-slate-200 pt-3 wrap-anywhere"
                >
                  <p className="font-semibold text-slate-800">
                    {branch.location.shopName} · {branch.location.name}
                  </p>
                  <p className="mt-1">
                    {[
                      branch.location.address1,
                      branch.location.address2,
                      branch.location.suburb,
                      branch.location.state,
                      branch.location.postcode,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                  {!branch.isAvailable && (
                    <p className="mt-1 text-amber-900">
                      {branch.unavailableReason ??
                        "This branch is unavailable. Remove it or choose another branch in My Stores."}
                    </p>
                  )}
                  {!branch.supermarketEnabled && (
                    <p className="mt-1 text-slate-600">
                      Supermarket not enabled in My Stores. This branch
                      selection is kept for later.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
