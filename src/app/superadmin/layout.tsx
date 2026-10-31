import type { Metadata } from "next";
import Link from "next/link";
import { hasAdministratorSession } from "@/lib/admin-session";
export const metadata: Metadata = { title: "Operations · MyShoppingList", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (!await hasAdministratorSession()) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">Administrator access required</h1><p className="mt-4">Sign in with an authorised administrator account to view operations.</p><Link className="mt-4 inline-block min-h-11 font-semibold text-primary-700 underline" href="/">Return to MyShoppingList</Link></main>;
  return <div className="min-h-screen bg-slate-50"><nav aria-label="Administration" className="flex flex-wrap gap-5 border-b bg-white px-6 py-4"><Link href="/superadmin">Overview</Link><Link href="/superadmin/marketing">Marketing</Link><Link href="/superadmin/billing">Test billing</Link><Link href="/superadmin/feedback">Feedback</Link><Link href="/admin">Accounts</Link><Link href="/admin/health">Retailer health</Link><Link href="/">My lists</Link></nav>{children}</div>;
}
