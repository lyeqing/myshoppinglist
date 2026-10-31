import Link from "next/link";
export default function PublicPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return <main className="mx-auto max-w-4xl px-5 py-10"><Link href="/" className="font-semibold text-primary-700">MyShoppingList</Link>
    <h1 className="mt-7 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{title}</h1><p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">{intro}</p>
    <div className="mt-8 space-y-7 leading-7 text-slate-700">{children}</div><div className="mt-9 flex flex-wrap gap-5"><Link href="/#main" data-analytics-cta="get-started" className="inline-flex min-h-11 items-center rounded-xl bg-primary-600 px-5 py-3 font-semibold text-white">Start a shopping list</Link><Link href="/support" data-analytics-cta="support" className="inline-flex min-h-11 items-center font-semibold text-primary-700 underline">Get help</Link></div>
  </main>;
}
