import Link from "next/link";

export default function ExtensionPage() {
  return <main className="mx-auto max-w-3xl px-5 py-10 text-slate-800">
    <Link href="/" className="text-sky-700 underline">← MyShoppingList</Link>
    <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-sky-700">Chrome extension · Local testing</p>
    <h1 className="mt-3 text-3xl font-semibold">Add products while you browse</h1>
    <p className="mt-4 leading-7">Open a Coles or Woolworths product, click MyShoppingList, choose your list and add it. Prices are checked in the background.</p>
    <section className="mt-7 rounded-2xl border border-sky-200 bg-sky-50 p-6"><h2 className="text-xl font-semibold">Install the local test extension</h2>
      <p className="mt-3">The extension is not published in the Chrome Web Store yet. For now, install it from this project on your computer.</p>
      <ol className="mt-4 list-decimal space-y-3 pl-5">
        <li>Start your API on <code>http://localhost:5392</code>.</li>
        <li>Open <code>chrome://extensions</code> in Chrome and turn on <strong>Developer mode</strong>.</li>
        <li>Click <strong>Load unpacked</strong> and select <code className="break-all">D:\pra\myshoppinglist\extensions\shopping-list</code>.</li>
        <li>Copy the extension ID and ask the local server owner to add it to <code className="break-all">UserExtension:AllowedExtensionIds</code>, then restart the API. Detailed setup is in the extension folder’s README.</li>
        <li>Pin <strong>MyShoppingList — Add to list (Local test)</strong> from Chrome’s Extensions menu.</li>
        <li>Visit a Coles or Woolworths product page, open the extension and sign in. Choose a list and click <strong>Add to list</strong>. If none exists, we create one for you.</li>
      </ol>
    </section>
    <p className="mt-6 text-sm leading-6 text-slate-600">This is separate from the Retailer Reader extension. It saves product links to your account. Passwords are not stored; sign in again after restarting Chrome. A Chrome Web Store installation link will replace these steps after publication.</p>
  </main>;
}
