"use client";

import Link from "next/link";

type Props = {
  accountId?: number;
  listId: number;
  itemId?: number;
  disabled?: boolean;
  onDiscovered: () => Promise<unknown>;
};
export default function PackDiscoveryControls({ accountId, itemId }: Props) {
  if (!accountId || itemId) return null;
  return (
    <p className="mb-4 rounded-xl bg-primary-50 p-4 text-sm text-slate-700">
      Want more prices, sizes or brands to compare? Save those products using the{" "}
      <Link href="/extension" className="font-semibold text-primary-700 underline">Chrome extension</Link>.
      {" "}Suggestions appear when suitable saved observations are available.
    </p>
  );
}
