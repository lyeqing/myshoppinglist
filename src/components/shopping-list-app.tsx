"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppHeader from "./app-header";
import { api, ApiError } from "@/lib/api-client";
import {
  type Session,
  type ShoppingListManagement,
  type ShoppingListSummary,
} from "@/lib/api-types";
import { Spinner } from "./import-card";
import ShoppingListItems from "./shopping-list-items";
import AccountForm from "./account-form";
import { useShallow } from "zustand/react/shallow";
import { useShoppingStore } from "./shopping-store-provider";

const primary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-primary-700 hover:bg-primary-800 active:bg-primary-800 px-5 py-3 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
  "rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
const aborted = (e: unknown) => e instanceof Error && e.name === "AbortError";

export default function ShoppingListApp() {
  const management = useShoppingStore((state) => state.management);
  const setManagement = useShoppingStore(
    (state) => state.actions.setManagement,
  );
  const [newListName, setNewListName] = useState("");
  const [listError, setListError] = useState("");
  const [managing, setManaging] = useState(false);
  const {
    session,
    booting,
    restoreError,
  } = useShoppingStore(
    useShallow((state) => ({
      session: state.session,
      booting: state.booting,
      restoreError: state.restoreError,
    })),
  );
  const {
    setSession,
    clearSession,
    setBooting,
    setRestoreError,
  } = useShoppingStore((state) => state.actions);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [accountMode, setAccountMode] = useState<"register" | "login" | null>(
    null,
  );
  const [authBusy, setAuthBusy] = useState(false);
  const authPending = useRef(false);
  const trialSession = useRef(false);
  const [notice, setNotice] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const changed = () => {
      generation.current++;
      lifetime.current?.abort();
      clearSession();
      setAccountMode(null);
      setAuthBusy(false);
      authPending.current = false;
      setNotice("");
      setRestoreAttempt((value) => value + 1);
    };
    window.addEventListener("myshoppinglist-session-changed", changed);
    return () =>
      window.removeEventListener("myshoppinglist-session-changed", changed);
  }, [clearSession]);

  const endSession = useCallback(
    (text: string) => {
      if (authPending.current) return;
      if (
        trialSession.current &&
        text === "Your session has ended. Sign in again or start a new trial."
      )
        text = "Your trial has ended. Start a new trial to continue.";
      generation.current++;
      clearSession();
      setNotice(text);
    },
    [clearSession],
  );
  const handleError = useCallback(
    (error: unknown, display: (text: string) => void) => {
      if (aborted(error)) return;
      if (error instanceof ApiError && error.status === 401)
        endSession(error.message);
      else display(message(error));
    },
    [endSession],
  );
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    async function restore() {
      try {
        const current = await api<Session>("/auth/me", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        trialSession.current = current.account.isTrial;
        setSession(current);
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !aborted(error) &&
          !(error instanceof ApiError && error.status === 401)
        )
          setRestoreError(message(error));
      } finally {
        if (!controller.signal.aborted) setBooting(false);
      }
    }
    void restore();
    return () => controller.abort();
  }, [restoreAttempt, setSession, setRestoreError, setBooting]);

  useEffect(() => {
    if (!session || authBusy) return;
    let timer: ReturnType<typeof setTimeout>;
    function check() {
      const delay =
        new Date(session!.sessionExpiresDate).getTime() - Date.now();
      if (delay <= 0)
        endSession(
          "Your session has ended. Sign in again or start a new trial.",
        );
      else timer = setTimeout(check, Math.min(delay, 2147483647));
    }
    check();
    return () => clearTimeout(timer);
  }, [session, authBusy, endSession]);

  function accountBusy(value: boolean) {
    authPending.current = value;
    setAuthBusy(value);
    if (value) {
      generation.current++;
    }
  }
  const accountReady = useCallback(
    (current: Session) => {
      const sameList =
        current.account.id === session?.account.id &&
        current.shoppingListId === session.shoppingListId;
      generation.current++;
      trialSession.current = current.account.isTrial;
      setSession(current);
      setAccountMode(null);
      setNotice(
        sameList
          ? "Your account is ready. Your list and edits are kept."
          : "You’re signed in.",
      );
    },
    [session, setSession],
  );

  useEffect(() => {
    if (!session || session.account.isTrial) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const value = await api<ShoppingListManagement>(
          "/shopping-lists/manage",
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setManagement(value);
          setListError("");
          if (
            session.shoppingListId &&
            !value.lists.some((list) => list.id === session.shoppingListId)
          ) {
            accountReady({
              ...session,
              shoppingListId: value.lists[0]?.id ?? null,
            });
            setNotice(
              "Your previous list is no longer active. Choose or create a list to continue.",
            );
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) setListError(message(error));
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [session, accountReady, setManagement]);

  async function manageList(action: "create" | "delete" | "archive") {
    if (!session || managing) return;
    const selected = management?.lists.find(
      (list) => list.id === session.shoppingListId,
    );
    if (action !== "create" && !selected) return;
    if (
      action === "delete" &&
      !window.confirm(
        `Delete “${selected!.name}” permanently? It will not appear in History.`,
      )
    )
      return;
    const version = generation.current;
    setManaging(true);
    setListError("");
    try {
      let created: ShoppingListSummary | undefined;
      if (action === "create")
        created = await api<ShoppingListSummary>("/shopping-lists", {
          method: "POST",
          body: JSON.stringify({ name: newListName }),
        });
      else {
        const latest = await api<ShoppingListManagement>(
          "/shopping-lists/manage",
        );
        if (version !== generation.current) return;
        const current = latest.lists.find((list) => list.id === selected!.id);
        if (!current)
          throw new Error("This list is no longer active. Refresh your lists.");
        await api<void>(
          `/shopping-lists/${current.id}${action === "archive" ? "/archive" : ""}`,
          {
            method: action === "archive" ? "POST" : "DELETE",
            body: JSON.stringify({ expectedUpdatedDate: current.updatedDate }),
          },
        );
      }
      const value = await api<ShoppingListManagement>("/shopping-lists/manage");
      if (version !== generation.current) return;
      setManagement(value);
      accountReady({
        ...session,
        shoppingListId: created?.id ?? value.lists[0]?.id ?? null,
      });
      setNewListName("");
      setNotice(
        action === "create"
          ? "Your new list is ready."
          : action === "archive"
            ? "List archived. Find it in History."
            : "List deleted permanently.",
      );
    } catch (error) {
      if (version === generation.current) {
        setListError(message(error));
        try {
          const value = await api<ShoppingListManagement>(
            "/shopping-lists/manage",
          );
          if (version === generation.current) setManagement(value);
        } catch {
          /* Keep the original error. */
        }
      }
    } finally {
      setManaging(false);
    }
  }

  async function startTrial() {
    setBusy(true);
    setNotice("");
    try {
      const current = await api<Session>("/auth/trial", {
        method: "POST",
        signal: lifetime.current?.signal,
      });
      if (lifetime.current?.signal.aborted) return;
      generation.current++;
      trialSession.current = current.account.isTrial;
      setSession(current);
      setAccountMode(null);
    } catch (error) {
      handleError(error, setNotice);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api<void>("/auth/logout", {
        method: "POST",
        signal: lifetime.current?.signal,
      });
      setAccountMode(null);
      endSession("You’ve signed out.");
    } catch (error) {
      handleError(error, setNotice);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3"
      >
        Skip to content
      </a>
      <AppHeader session={session} active="lists" loading={booting} disabled={busy || authBusy} onSignOut={logout} showSignIn={false} />
      <main
        id="main"
        className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14"
      >
        <div className="mb-6">
          <Link href="/extension" className={secondary}>
            Add Chrome extension
          </Link>
        </div>

        {session && !session.account.isTrial && (
          <section
            aria-label="Manage shopping lists"
            className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Your lists</h2>
              {session.account.isPaid && (
                <Link href="/history" className="font-semibold text-primary-700">
                  History
                </Link>
              )}
            </div>
            {management && (
              <>
                <p className="my-3 text-sm text-slate-500">
                  {management.lists.length} of {management.limit} active lists ·{" "}
                  {management.isPaid ? "Paid account" : "Free account"}
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-48 flex-1 text-sm font-medium">
                    Selected list
                    <select
                      aria-label="Selected list"
                      className="mt-1 block w-full rounded-xl border border-slate-300 p-3"
                      disabled={managing || authBusy}
                      value={session.shoppingListId ?? ""}
                      onChange={(event) => {
                        accountReady({
                          ...session,
                          shoppingListId: Number(event.target.value),
                        });
                        setNotice("");
                      }}
                    >
                      <option value="" disabled>
                        {management.lists.length
                          ? "Choose a list"
                          : "No active lists"}
                      </option>
                      {management.lists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {management.isPaid && (
                    <button
                      className={secondary}
                      disabled={
                        managing ||
                        authBusy ||
                        !session.shoppingListId
                      }
                      onClick={() => void manageList("archive")}
                    >
                      Archive list
                    </button>
                  )}
                  <button
                    className={`${secondary} text-red-700`}
                    disabled={
                      managing ||
                      authBusy ||
                      !session.shoppingListId
                    }
                    onClick={() => void manageList("delete")}
                  >
                    Delete list
                  </button>
                </div>
                <form
                  className="mt-4 flex flex-wrap items-end gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void manageList("create");
                  }}
                >
                  <label className="min-w-48 flex-1 text-sm font-medium">
                    New list name (optional)
                    <input
                      maxLength={200}
                      className="mt-1 block w-full rounded-xl border border-slate-300 p-3"
                      value={newListName}
                      onChange={(event) => setNewListName(event.target.value)}
                      placeholder="Leave blank for an automatic name"
                      disabled={managing || authBusy}
                    />
                  </label>
                  <button
                    className={primary}
                    disabled={
                      managing ||
                      authBusy ||
                      management.lists.length >= management.limit
                    }
                  >
                    Create new list
                  </button>
                </form>
                {management.lists.length >= management.limit && (
                  <p className="mt-3 text-sm text-amber-800">
                    {management.isPaid
                      ? "Delete or archive a list to free a slot."
                      : "Delete a list to free a slot."}
                  </p>
                )}
              </>
            )}
            {listError && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {listError}
              </p>
            )}
          </section>
        )}

        <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-3 text-xs font-semibold tracking-widest text-primary-700">
              LESS GUESSWORK. BETTER SHOPPING.
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Your list. <span className="text-primary-700">A clearer price.</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-500">
              Save products with the Chrome extension. Keep observed prices
              with your shopping list and manage your shop on any device.
            </p>
          </div>
          {session && (
            <div className="max-w-full break-words rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <span className="font-semibold">
                {session.account.isTrial
                  ? "Your trial is active"
                  : "Your list is saved"}
              </span>
              <p className="mt-1 text-xs">
                {session.account.isTrial
                  ? `Expires ${new Date(session.sessionExpiresDate).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })} · No account needed`
                  : "Your shopping list is saved to your account."}
              </p>
            </div>
          )}
        </div>
        {notice && (
          <p
            role="status"
            className="mb-6 rounded-xl border border-primary-300 bg-primary-50 px-4 py-3 text-sm text-primary-700"
          >
            {notice}
          </p>
        )}
        {!booting && !restoreError && (!session || session.account.isTrial) && (
          <div className="mb-5 flex flex-wrap gap-3">
            <button
              disabled={busy || authBusy}
              onClick={() => setAccountMode("register")}
              className={secondary}
            >
              {session ? "Keep my list" : "Create an account"}
            </button>
            <button
              disabled={busy || authBusy}
              onClick={() => setAccountMode("login")}
              className={secondary}
            >
              Sign in
            </button>
          </div>
        )}
        {accountMode && (
          <AccountForm
            key={accountMode}
            mode={accountMode}
            trial={!!session?.account.isTrial}
            onBusy={accountBusy}
            onSuccess={accountReady}
            onClose={() => setAccountMode(null)}
          />
        )}
        {booting ? (
          <div
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-slate-500"
            role="status"
          >
            <Spinner /> Restoring your shopping list…
          </div>
        ) : restoreError ? (
          <section className="rounded-2xl border border-amber-200 bg-white p-8">
            <h2 className="text-lg font-semibold">
              We couldn’t restore your shopping list
            </h2>
            <p role="alert" className="mt-2 text-sm text-amber-900">
              {restoreError}
            </p>
            <button
              className={`${primary} mt-5`}
              onClick={() => {
                setRestoreError("");
                setBooting(true);
                setRestoreAttempt((attempt) => attempt + 1);
              }}
            >
              Retry restoring my list
            </button>
          </section>
        ) : !session ? (
          <section className="grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm md:grid-cols-2">
            <div className="p-7 sm:p-10">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                FREE 3-HOUR TRIAL
              </span>
              <h2 className="mt-6 text-3xl font-semibold tracking-tight">
                A small step before
                <br />
                your next shop.
              </h2>
              <p className="mt-4 max-w-md leading-7 text-slate-500">
                Try a temporary shopping list. No email, password, or payment
                details. Your list expires after three hours.
              </p>
              <button
                onClick={startTrial}
                disabled={busy || authBusy}
                className={`${primary} mt-7`}
              >
                {busy && <Spinner />}
                {busy ? "Starting your trial…" : "Start my shopping list"}
                <span aria-hidden="true">→</span>
              </button>
              <p className="mt-4 text-xs text-slate-400">
                Collect Coles, Woolworths and ALDI products with the extension.
              </p>
            </div>
            <div className="border-t border-slate-100 bg-primary-50/60 p-7 sm:p-10 md:border-l md:border-t-0">
              <p className="text-xs font-semibold tracking-widest text-slate-500">
                THREE SIMPLE STEPS
              </p>
              <ol className="mt-7 space-y-7">
                {[
                  [
                    "Open a product page",
                    "Visit Coles, Woolworths or ALDI in Chrome on your computer.",
                  ],
                  [
                    "Review and save",
                    "Use the extension to read the product, choose your list and confirm.",
                  ],
                  [
                    "Manage your shopping",
                    "View your observations and edit your list on desktop or mobile.",
                  ],
                ].map(([title, detail], i) => (
                  <li key={title} className="flex gap-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary-300 bg-white text-sm font-semibold text-primary-700">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold">{title}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        ) : (
          <div className="grid items-start gap-7 lg:grid-cols-[340px_1fr]">
            <aside className="space-y-5 lg:sticky lg:top-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="add-products">
                <h2 id="add-products" className="text-lg font-semibold">Add products with the Chrome extension</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  On your computer, open a Coles, Woolworths or ALDI product page.
                  Click MyShoppingList, choose your list and quantity, then read,
                  review and save the product.
                </p>
                <Link href="/extension" className={primary + " mt-5"}>Extension setup and instructions</Link>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  On mobile, you can manage your saved lists here. Collect new
                  products using Chrome on your computer.
                </p>
              </section>
              <div className="rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold">A note on prices</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  These are observed page prices. Your store’s price and
                  availability may differ. We’ll always show what we could
                  verify.
                </p>
              </div>
            </aside>
            <div>
              {session.shoppingListId && (
                <ShoppingListItems
                  key={`${session.account.id}:${session.shoppingListId}`}
                  listId={session.shoppingListId}
                  refreshKey={String(restoreAttempt)}
                  onExpired={endSession}
                />
              )}
            </div>
          </div>
        )}
        <section
          className="mt-10 border-t border-slate-200 pt-6"
          aria-label="Retailer support"
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <span className="text-xs font-semibold tracking-widest text-slate-400">
              RETAILER SUPPORT
            </span>
            <span className="font-semibold text-slate-700">
              Coles · Woolworths · ALDI{" "}
              <span className="ml-1 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                Extension
              </span>
            </span>
            <span className="text-slate-400">
              Read and save products you choose
            </span>
            <span className="text-slate-400">
              IGA · Foodland <span className="ml-1 text-xs">Coming later</span>
            </span>
          </div>
          <p className="mt-4 text-xs leading-6 text-slate-400">
            MyShoppingList is independent of these retailers. Comparison
            coverage varies by retailer. Some prices need verification. Existing
            list-item quantities are replaced when you save the same product
            again.
          </p>
        </section>
      </main>
    </>
  );
}
