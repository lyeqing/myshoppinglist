import type { Metadata } from "next";
import { hasAdministratorSession } from "@/lib/admin-session";
import Link from "next/link";
export const metadata: Metadata = { title: "Administration · MyShoppingList", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (!await hasAdministratorSession()) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">Administrator access required</h1><p className="mt-4">Sign in with an authorised administrator account.</p><Link href="/" className="mt-4 inline-block min-h-11 font-semibold underline">Return to MyShoppingList</Link></main>;
  return children;
}
