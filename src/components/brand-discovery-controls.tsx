"use client";

type Props = {
  accountId?: number;
  listId: number;
  itemId?: number;
  disabled?: boolean;
  onDiscovered: () => Promise<unknown>;
};
// Collection searches are retired. Brand suggestions still come from saved
// observations, with guidance in ComparisonPreferences.
export default function BrandDiscoveryControls(_props: Props) {
  void _props;
  return null;
}
