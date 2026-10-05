"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "zustand";
import { createHistoryStore } from "@/stores/history-store";

const button =
  "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50";
export default function HistoryApp() {
  const [store] = useState(createHistoryStore);
  const state = useStore(store);
  useEffect(() => {
    const reload = () => void store.getState().load();
    reload();
    window.addEventListener("myshoppinglist-session-changed", reload);
    window.addEventListener("focus", reload);
    return () => {
      store.getState().dispose();
      window.removeEventListener("myshoppinglist-session-changed", reload);
      window.removeEventListener("focus", reload);
    };
  }, [store]);
  const canSee =
    state.session?.account.isPaid &&
    !state.session.account.isTrial &&
    !state.forbidden;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <Link href="/" className="font-semibold text-sky-800">
            MyShoppingList
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex gap-4 text-sm font-semibold"
          >
            <Link href="/">My lists</Link>
            <Link href="/in-store">Shop in store</Link>
            {canSee && (
              <Link href="/history" aria-current="page">
                History
              </Link>
            )}
          </nav>
          {state.session ? (
            <div className="flex items-center gap-3 text-sm">
              <span>{state.session.account.displayName}</span>
              <button
                className={button}
                disabled={state.loading}
                onClick={() => void state.logout()}
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link href="/" className={button}>
              Sign in
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10">
        <p className="text-xs font-semibold tracking-widest text-sky-700">
          YOUR PAST LISTS
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Shopping history</h1>
        <p className="mt-3 text-slate-600">
          Archived lists and their saved items. These are not receipts or
          historical purchase prices.
        </p>
        {state.loading && (
          <p role="status" className="mt-6">
            Loading history…
          </p>
        )}
        {state.error && (
          <div
            role="alert"
            className="mt-6 rounded-xl bg-red-50 p-4 text-red-800"
          >
            {state.error}
            <button
              className={`${button} ml-3`}
              disabled={state.loading}
              onClick={() => void state.load()}
            >
              Retry
            </button>
          </div>
        )}
        {!state.loading && !canSee && (
          <p className="mt-6 rounded-xl bg-sky-50 p-5">
            {state.session
              ? "Shopping history is available to paid accounts only."
              : "Sign in with a paid account to view your history."}
          </p>
        )}
        {canSee && !state.loading && (
          <>
            {state.detail ? (
              <section className="mt-8">
                <button className={button} onClick={() => void state.load()}>
                  ← All history
                </button>
                <h2 className="mt-5 text-2xl font-semibold">
                  {state.detail.list.name}
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Archived{" "}
                  {new Date(state.detail.list.updatedDate).toLocaleDateString(
                    "en-AU",
                  )}
                </p>
                <ul className="mt-5 space-y-3">
                  {state.detail.items.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-2xl border border-slate-200 bg-white p-5"
                    >
                      <h3 className="font-semibold">{item.product.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Quantity {item.quantity} ·{" "}
                        {item.isPurchased
                          ? "Purchased"
                          : item.isHidden
                            ? "Hidden"
                            : "Not marked purchased"}
                      </p>
                      {item.notes && (
                        <p className="mt-2 whitespace-pre-wrap text-sm">
                          {item.notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                {!state.detail.items.length && (
                  <p className="mt-5">This archived list has no items.</p>
                )}
                <button
                  className={`${button} mt-6 text-red-700`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete “${state.detail!.list.name}” permanently? It will no longer appear in History.`,
                      )
                    )
                      void state.remove(state.detail!.list);
                  }}
                >
                  Delete archived list
                </button>
              </section>
            ) : (
              <ul className="mt-8 space-y-3">
                {state.lists.map((list) => (
                  <li key={list.id}>
                    <button
                      className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-sky-500"
                      onClick={() => void state.load(list.id)}
                    >
                      <span className="block font-semibold">{list.name}</span>
                      <span className="mt-1 block text-sm text-slate-500">
                        Archived{" "}
                        {new Date(list.updatedDate).toLocaleDateString("en-AU")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!state.detail && !state.lists.length && (
              <p className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
                No archived lists yet.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
