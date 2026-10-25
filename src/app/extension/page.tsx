import Link from "next/link";

export default function ExtensionPage() {
  return <main className="mx-auto max-w-3xl px-5 py-10 text-slate-800">
    <Link href="/" className="text-sky-700 underline">← MyShoppingList</Link>
    <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-sky-700">Chrome extension · Local testing</p>
    <h1 className="mt-3 text-3xl font-semibold">Save products you choose</h1>
    <p className="mt-4 leading-7">Open a Coles, Woolworths or ALDI product page. Choose your list and quantity, click <strong>Read product</strong>, review the details, then <strong>Save to list</strong>. Products and price observations are private to your account.</p>
    <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">Personal capture is being prepared. The server owner must enable this staged update after the website and existing-data transition are ready. Until then, the extension reports that personal capture is unavailable. Existing lists remain stored.</p>
    <section className="mt-7 rounded-2xl border border-sky-200 bg-sky-50 p-6"><h2 className="text-xl font-semibold">Install the local test extension</h2>
      <p className="mt-3">The extension is not published in the Chrome Web Store yet. For now, install it from this project on your computer.</p>
      <ol className="mt-4 list-decimal space-y-3 pl-5">
        <li>Start your API on <code>http://localhost:5392</code>.</li>
        <li>Open <code>chrome://extensions</code> in Chrome and turn on <strong>Developer mode</strong>.</li>
        <li>Click <strong>Load unpacked</strong> and select <code className="break-all">D:\pra\myshoppinglist\extensions\shopping-list</code>.</li>
        <li>Give the extension ID to the server owner. Setup and rollout requirements are in the extension folder’s README.</li>
        <li>Pin <strong>MyShoppingList — Add to list (Local test)</strong> from Chrome’s Extensions menu.</li>
        <li>Visit a supported product page and open the blue basket extension. It shares your website sign-in. Review the product before saving. If no list exists, one is created using your local date only when you save.</li>
      </ol>
    </section>
    <p className="mt-6 text-sm leading-6 text-slate-600">The extension reads only the product page you choose after you click Read product. Missing prices are shown clearly; you can save without one. Observation dates record when you read the page, and store locations remain unverified. Visit and save each retailer yourself to collect prices for comparison. If a save is unconfirmed, use Retry save to safely check the same request. Signing out affects both the website and extension.</p>
  </main>;
}
