import type { ReactNode } from "react";

const benefits = [
  ["Keep it together", "Your lists, saved products and price observations have one home. Pick up your planning on desktop or mobile."],
  ["Make informed choices", "Review product suggestions and see where saved prices came from and when they were observed."],
  ["Stay in control", "Your lists belong to your account. Choose which AI apps can access them and revoke access when you need to."],
];

export default function GuestLanding({ onCreateAccount, disabled, accountForm, feedback }: {
  onCreateAccount: () => void;
  disabled: boolean;
  accountForm?: ReactNode;
  feedback?: ReactNode;
}) {
  return <div className="space-y-16 sm:space-y-20">
    <section aria-labelledby="landing-title" className="grid items-center gap-10 pt-3 sm:pt-8 lg:grid-cols-[1.35fr_1fr] lg:gap-16">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">Made for everyday shopping in Australia</p>
        <h1 id="landing-title" className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-6xl">
          Less shopping guesswork.<br /><span className="text-primary-700">More organised shopping.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">Keep your shopping lists, saved products and price observations together. Explore options with your connected AI app, then choose what you save and buy.</p>
        <button type="button" onClick={onCreateAccount} disabled={disabled} data-analytics-cta="signup"
          className="mt-8 inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-primary-700 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-primary-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-50">
          Create a free account <span aria-hidden="true">→</span>
        </button>
        <p className="mt-3 text-sm text-slate-500">Free to get started. No payment details needed.</p>
      </div>
      <div className="relative overflow-hidden rounded-3xl bg-primary-700 p-8 text-white sm:p-10">
        <div aria-hidden="true" className="absolute -right-16 -top-16 size-56 rounded-full border border-white/15" />
        <div aria-hidden="true" className="absolute -bottom-24 -right-6 size-64 rounded-full border border-white/15" />
        <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className="relative size-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 12h-4v30h28V12h-4M18 8h12v8H18zM16 25l3 3 6-6M16 34l3 3 6-6M29 26h4M29 35h4" />
        </svg>
        <p className="relative mt-8 text-3xl font-semibold leading-snug sm:text-4xl">Your list.<br />Your choices.<br />Your control.</p>
        <p className="relative mt-6 max-w-sm leading-7 text-emerald-50">A calmer place to plan your next shop, keep useful information and make decisions that work for you.</p>
      </div>
    </section>

    {feedback}
    {accountForm}

    <section aria-labelledby="why-title" className="grid gap-5 border-t border-slate-200 pt-12 md:grid-cols-2 md:gap-12">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-primary-700">Why we built MyShoppingList</p><h2 id="why-title" className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-tight">Shopping should feel less scattered.</h2></div>
      <div className="space-y-4 leading-8 text-slate-600"><p>Shopping information ends up across supermarket websites, notes and AI conversations. Finding it again can become another job on your list.</p><p>We’re bringing your planning into one place, so you can spend less time piecing things together and more time deciding what works for your household.</p></div>
    </section>

    <section aria-labelledby="benefits-title">
      <h2 id="benefits-title" className="text-3xl font-semibold tracking-tight">A little more clarity for every shop.</h2>
      <div className="mt-7 grid gap-5 md:grid-cols-3">
        {benefits.map(([title, description], index) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-7">
          <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-xl bg-primary-50 text-sm font-semibold text-primary-700">0{index + 1}</span>
          <h3 className="mt-5 text-xl font-semibold">{title}</h3><p className="mt-3 leading-7 text-slate-600">{description}</p>
        </article>)}
      </div>
    </section>

    <section aria-labelledby="getting-started-title" className="rounded-3xl border border-primary-100 bg-primary-50/60 p-7 sm:p-10">
      <h2 id="getting-started-title" className="text-3xl font-semibold tracking-tight">Start simple. Make it your own.</h2>
      <ol className="mt-8 grid gap-7 md:grid-cols-3">
        {[
          ["Create your free account", "Sign in to keep your lists private and return to them on another device."],
          ["Bring your planning together", "Build a list for your household and keep useful product details close at hand."],
          ["Connect AI when you’re ready", "Connect a supported AI app where available. You approve its permissions and review what you choose to save."],
        ].map(([title, description], index) => <li key={title}><p className="text-sm font-semibold text-primary-700">Step {index + 1}</p><h3 className="mt-2 text-lg font-semibold">{title}</h3><p className="mt-3 leading-7 text-slate-600">{description}</p></li>)}
      </ol>
    </section>
    <p className="max-w-3xl text-sm leading-6 text-slate-500">Saved prices include their source and date. Confirm current prices and availability with the retailer before buying.</p>
  </div>;
}
