import Link from "next/link";
export default function SiteFooter() {
  return <footer className="border-t border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-600"><nav aria-label="About MyShoppingList" className="mx-auto flex max-w-5xl flex-wrap gap-x-6 gap-y-4">
    {[["Features", "/features"], ["How it works", "/how-it-works"], ["FAQ", "/faq"], ["Plans", "/pricing"], ["Support", "/support"], ["Privacy", "/privacy"]].map(([label, href]) => <Link key={href} href={href} className="inline-flex min-h-11 items-center underline">{label}</Link>)}
  </nav></footer>;
}
