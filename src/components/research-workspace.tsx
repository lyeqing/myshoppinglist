"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AppHeader from "./app-header";
import { api, ApiError } from "@/lib/api-client";
import type { Session } from "@/lib/api-types";

type Job = { id: string; query: string; status: string; openIssues: number };
type Candidate = {
  id: string;
  validation: string;
  issues: string[];
  priceVerification: string;
  comparableUnitPrice: number | null;
  unitBasis: string | null;
  selectedProductId: string | null;
  report: {
    key: string;
    retailer: string;
    url: string;
    identity: {
      name: string;
      brand: string | null;
      variant: string | null;
      packSize: number | null;
      packUnit: string | null;
      packQuantity: number | null;
    };
    price: number | null;
    currency: string;
    observedAt: string;
    evidence: string;
    match: string;
    promotion: string | null;
  };
};
type Issue = {
  id: string;
  retailer: string;
  code: string;
  target: string;
  detail: string;
  status: string;
  revision: number;
  resolution: string | null;
};
type Review = {
  id: string;
  query: string;
  status: string;
  candidates: Candidate[];
  issues: Issue[];
};
type Task = {
  productId: string;
  name: string;
  retailer: string;
  reason: string;
  url: string;
  lastObservedAt: string | null;
};
type Instructions = { version: string; rules: string[] };
type Receipt = {
  status: string;
  researchJobId?: string;
  itemId?: string;
  replayed?: boolean;
};
const statusLabels: Record<string, string> = {
  AwaitingSelection: "Choose a product",
  PartiallyCompleted: "Partially researched",
  Selected: "Product selected",
  Failed: "Needs more research",
  Open: "Action needed",
  Resolved: "Acknowledged",
  CannotVerify: "Could not verify",
};
const button =
  "min-h-11 rounded-xl bg-primary-700 px-5 py-3 font-semibold text-white disabled:opacity-50";
const secondary =
  "min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50";
const field =
  "mt-2 block w-full rounded-xl border border-slate-300 bg-white p-3";

export default function ResearchWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [lists, setLists] = useState<{ id: number; name: string }[]>([]);
  const [listId, setListId] = useState("");
  const [query, setQuery] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [instructions, setInstructions] = useState<Instructions | null>(null);
  const [draft, setDraft] = useState("");
  const [prepared, setPrepared] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const epoch = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const retryIds = useRef(new Map<string, string>());
  const loadedAccount = useRef<number | null>(null);
  const accountHeaders = session
    ? { "X-MyShoppingList-Account": String(session.account.id) }
    : undefined;
  const [reasons, setReasons] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++epoch.current;
    const changed = () => {
      ++epoch.current;
      controller.abort();
      pending.current?.abort();
      retryIds.current.clear();
      setSession(null);
      setLists([]);
      setListId("");
      setJobs([]);
      setReview(null);
      setTasks(null);
      setDraft("");
      setQuery("");
      setQuantity(1);
      setPrepared("");
      setReasons({});
      setNotice("");
      setError("");
      setBusy(false);
      setLoading(true);
      setAttempt((value) => value + 1);
    };
    window.addEventListener("myshoppinglist-session-changed", changed);
    api<Session>("/auth/me", { signal: controller.signal })
      .then(async (current) => {
        if (epoch.current !== generation) return;
        if (
          loadedAccount.current !== null &&
          loadedAccount.current !== current.account.id
        ) {
          setReview(null);
          setDraft("");
          setQuery("");
          setPrepared("");
          setReasons({});
          setTasks(null);
          setLists([]);
          setListId("");
          setJobs([]);
          setNotice("");
          retryIds.current.clear();
          setQuantity(1);
        }
        loadedAccount.current = current.account.id;
        setSession(current);
        if (current.account.isTrial) return;
        const [management, recent, workflow] = await Promise.all([
          api<{ lists: { id: number; name: string }[] }>(
            "/shopping-lists/manage",
            { signal: controller.signal },
          ),
          api<Job[]>("/research", {
            signal: controller.signal,
            headers: { "X-MyShoppingList-Account": String(current.account.id) },
          }),
          api<Instructions>("/research/instructions", {
            signal: controller.signal,
          }),
        ]);
        if (epoch.current !== generation) return;
        setLists(management.lists);
        setJobs(recent);
        setInstructions(workflow);
        setListId(
          String(
            management.lists.find((l) => l.id === current.shoppingListId)?.id ??
              management.lists[0]?.id ??
              "",
          ),
        );
      })
      .catch((e) => {
        if (
          !controller.signal.aborted &&
          e instanceof ApiError &&
          e.status === 409 &&
          e.message.startsWith("Your account changed.")
        ) {
          window.dispatchEvent(new Event("myshoppinglist-session-changed"));
          return;
        }
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load research.");
      })
      .finally(() => {
        if (epoch.current === generation) setLoading(false);
      });
    return () => {
      controller.abort();
      pending.current?.abort();
      window.removeEventListener("myshoppinglist-session-changed", changed);
    };
  }, [attempt]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const generation = epoch.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action(controller.signal);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status === 409 &&
        e.message.startsWith("Your account changed.")
      ) {
        window.dispatchEvent(new Event("myshoppinglist-session-changed"));
        return;
      }
      if (epoch.current === generation && !controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "The operation could not be completed. Try again.",
        );
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  }
  function id(key: string) {
    if (!retryIds.current.has(key))
      retryIds.current.set(key, crypto.randomUUID());
    return retryIds.current.get(key)!;
  }
  async function loadReview(jobId: string, signal: AbortSignal) {
    const result = await api<Review>(`/research/${jobId}`, {
      signal,
      headers: accountHeaders,
    });
    if (!signal.aborted) {
      setReview(result);
      if (review?.id !== jobId) setReasons({});
      setJobs((value) =>
        value.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status: result.status,
                openIssues: result.issues.filter(
                  (issue) => issue.status === "Open",
                ).length,
              }
            : job,
        ),
      );
    }
  }
  function prepare() {
    const list = lists.find((l) => String(l.id) === listId);
    setPrepared(
      `Use my connected MyShoppingList tools. Call get_research_instructions and get_shopping_context, then search_my_products before browsing.\n\nMy request: ${query.trim()}\nPackage quantity: ${quantity}. Target list: ${list?.name ?? "ask me to choose"} (ID ${listId || "not selected"}).\n\nPresent ambiguous choices and preserve my brand/variant requirements. Submit research using workflow ${instructions?.version ?? "from the instructions tool"}. Prices must stay labelled unverified. Only add my chosen candidate after my authorization. Report blocked retailers and missing prices. If your plan cannot submit through MCP, return the structured ResearchSubmission response described by the instructions tool for me to import on the website. Do not claim that opening this AI app automatically runs research.`,
    );
    setNotice(
      "Request prepared. Copy it, open your AI app, enable your connection and send it.",
    );
  }
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader
        session={session}
        active="lists"
        loading={loading}
        disabled={busy}
      />
      <main className="mx-auto max-w-4xl space-y-6 px-5 py-8">
        <h1 className="text-3xl font-semibold">Research products</h1>
        <p className="text-slate-600">
          Use your own AI app to find products, then review and save your
          choice. AI access and web research
          depend on your plan and the retailer.
        </p>
        <p>
          <Link
            href="/ai/connections"
            className="font-semibold text-primary-700 underline"
          >
            Manage AI connections
          </Link>{" "}
          ·{" "}
          <Link href="/" className="underline">
            My lists
          </Link>
        </p>
        {loading && <p role="status">Loading your research…</p>}
        {error && (
          <div
            role="alert"
            className="rounded-xl bg-amber-50 p-4 text-amber-900"
          >
            {error}
            <button
              disabled={busy}
              onClick={() => {
                setLoading(true);
                setAttempt((v) => v + 1);
              }}
              className="ml-3 underline"
            >
              Reload research
            </button>
          </div>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-xl bg-emerald-50 p-4 text-emerald-900"
          >
            {notice}
          </p>
        )}
        {!loading && (!session || session.account.isTrial) && (
          <p>
            <Link href="/" className="font-semibold underline">
              Sign in with a registered account
            </Link>{" "}
            to keep private research and select products.
          </p>
        )}
        {session && !session.account.isTrial && (
          <>
            <section
              aria-labelledby="research-request"
              className="rounded-2xl border border-slate-200 bg-white p-6"
            >
              <h2 id="research-request" className="text-xl font-semibold">
                What would you like to buy?
              </h2>
              {!lists.length && (
                <p className="mt-3">
                  Create an active list in{" "}
                  <Link href="/" className="underline">
                    My lists
                  </Link>{" "}
                  first.
                </p>
              )}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label>
                  Shopping list
                  <select
                    className={field}
                    value={listId}
                    disabled={busy}
                    onChange={(e) => {
                      setListId(e.target.value);
                      setTasks(null);
                      setPrepared("");
                    }}
                  >
                    <option value="">Choose a list</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Package quantity
                  <input
                    className={field}
                    type="number"
                    min={1}
                    max={10000}
                    value={quantity}
                    disabled={busy}
                    onChange={(e) => {
                      setQuantity(Number(e.target.value));
                      setPrepared("");
                    }}
                  />
                </label>
              </div>
              <label className="mt-4 block">
                Product or shopping request
                <textarea
                  className={field}
                  maxLength={500}
                  rows={3}
                  value={query}
                  disabled={busy}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPrepared("");
                  }}
                  placeholder="For example, Kleenex toilet tissue. Show me pack sizes before adding."
                />
              </label>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className={button}
                  disabled={
                    busy ||
                    !listId ||
                    !query.trim() ||
                    !Number.isInteger(quantity) ||
                    quantity < 1 ||
                    quantity > 10000
                  }
                  onClick={prepare}
                >
                  Prepare AI request
                </button>
                <button
                  className={secondary}
                  disabled={
                    busy ||
                    !listId ||
                    !query.trim() ||
                    !Number.isInteger(quantity) ||
                    quantity < 1 ||
                    quantity > 10000
                  }
                  onClick={() =>
                    void run(async (signal) => {
                      await api(`/research/generic/${listId}`, {
                        method: "POST",
                        headers: accountHeaders,
                        signal,
                        body: JSON.stringify({ name: query.trim(), quantity }),
                      });
                      if (!signal.aborted)
                        setNotice(
                          "Item saved without a retailer price. An existing item keeps its quantity.",
                        );
                    })
                  }
                >
                  Add item without a price
                </button>
                <button
                  className={secondary}
                  disabled={busy || !listId}
                  onClick={() =>
                    void run(async (signal) => {
                      const result = await api<Task[]>(
                        `/research/refresh/${listId}?pageSize=20`,
                        { signal, headers: accountHeaders },
                      );
                      if (!signal.aborted) {
                        setTasks(result);
                        setPrepared("");
                      }
                    })
                  }
                >
                  Find prices needing research
                </button>
              </div>
              {prepared && (
                <div className="mt-5 space-y-3">
                  <label>
                    Prepared research request
                    <textarea
                      className={field}
                      rows={7}
                      readOnly
                      value={prepared}
                    />
                  </label>
                  <button
                    className={secondary}
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(prepared);
                        setNotice(
                          "Research request copied. Open your AI app and send it with your connection enabled.",
                        );
                      })
                    }
                  >
                    Copy request
                  </button>
                  <a
                    href="https://chatgpt.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={secondary + " inline-block ml-3"}
                  >
                    Open ChatGPT
                  </a>
                  <a
                    href="https://claude.ai/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={secondary + " inline-block ml-3"}
                  >
                    Open Claude
                  </a>
                  <p className="text-sm text-slate-600">
                    These links open the AI app. They do not send or run your
                    request. Some plans support reading only; you can import a
                    structured response below.
                  </p>
                </div>
              )}
              {tasks && (
                <div className="mt-5">
                  <h3 className="font-semibold">Prices needing research</h3>
                  {!tasks.length ? (
                    <p className="mt-2">
                      No eligible refresh targets were found. Recent retailer
                      failures may be waiting for their retry time; this does
                      not mean every item has a verified price.
                    </p>
                  ) : (
                    <>
                      <ul className="mt-2 space-y-2">
                        {tasks.map((t, index) => (
                          <li key={`${t.productId}-${t.retailer}-${index}`}>
                            {t.name} · {t.retailer} ·{" "}
                            {t.reason.replaceAll("_", " ")}
                          </li>
                        ))}
                      </ul>
                      <button
                        className={secondary + " mt-3"}
                        onClick={() => {
                          setPrepared(
                            `Use my connected MyShoppingList tools. Call get_research_instructions and get_price_refresh_tasks for list ${listId}. Research the following targets in batches, submit evidence and report all remaining issues. Do not add products or change quantities.\n${tasks.map((t) => `${t.name} — ${t.retailer}: ${t.url}`).join("\n")}`,
                          );
                        }}
                      >
                        Prepare price refresh request
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
            <section
              aria-labelledby="research-history"
              className="rounded-2xl border border-slate-200 bg-white p-6"
            >
              <h2 id="research-history" className="text-xl font-semibold">
                Your research
              </h2>
              <button
                className={secondary + " mt-3"}
                disabled={busy}
                onClick={() =>
                  void run(async (signal) => {
                    const result = await api<Job[]>("/research", {
                      signal,
                      headers: accountHeaders,
                    });
                    if (!signal.aborted) setJobs(result);
                  })
                }
              >
                Refresh research
              </button>
              {!jobs.length && (
                <p className="mt-3">
                  No research submitted yet. Send a prepared request from your
                  connected AI app, then refresh this list.
                </p>
              )}
              <ul className="mt-4 space-y-3">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <button
                      className="text-left font-semibold text-primary-700 underline"
                      disabled={busy}
                      onClick={() =>
                        void run((signal) => loadReview(j.id, signal))
                      }
                    >
                      {j.query}
                    </button>
                    <span className="ml-2 text-sm">
                      {statusLabels[j.status] ?? j.status} · {j.openIssues} open
                      issues
                    </span>
                  </li>
                ))}
              </ul>
              <details className="mt-6">
                <summary className="cursor-pointer font-semibold">
                  Import a response from an AI app that cannot submit
                </summary>
                <p className="mt-2 text-sm text-slate-600">
                  Paste the structured research response produced using the
                  current MyShoppingList instructions. Importing saves
                  candidates for review; it does not add them to your list.
                </p>
                <label className="mt-3 block">
                  AI research response
                  <textarea
                    className={field}
                    value={draft}
                    rows={6}
                    maxLength={60000}
                    disabled={busy}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                </label>
                <button
                  className={button + " mt-3"}
                  disabled={busy || !draft.trim()}
                  onClick={() =>
                    void run(async (signal) => {
                      let value: Record<string, unknown>;
                      try {
                        value = JSON.parse(draft);
                        if (
                          !value ||
                          Array.isArray(value) ||
                          typeof value !== "object"
                        )
                          throw new Error();
                      } catch {
                        throw new Error(
                          "Paste the structured response from your AI app. The response must be a valid JSON object.",
                        );
                      }
                      const result = await api<Receipt>("/research", {
                        method: "POST",
                        headers: accountHeaders,
                        signal,
                        body: JSON.stringify({
                          ...value,
                          requestId: id(`import:${draft}`),
                        }),
                      });
                      if (signal.aborted) return;
                      if (result.researchJobId)
                        await loadReview(result.researchJobId, signal);
                      const recent = await api<Job[]>("/research", {
                        signal,
                        headers: accountHeaders,
                      });
                      if (!signal.aborted) {
                        setJobs(recent);
                        setNotice(
                          "Research imported. Review the candidates and remaining issues before choosing a product.",
                        );
                      }
                    })
                  }
                >
                  Import for review
                </button>
              </details>
            </section>
            {review && (
              <section aria-labelledby="research-review" className="space-y-4">
                <h2 id="research-review" className="text-2xl font-semibold">
                  Review: {review.query}
                </h2>
                <p className="rounded-xl bg-amber-50 p-4 text-amber-900">
                  Reported prices are unverified AI research. They are excluded
                  from basket totals and savings. Selecting a product does not
                  verify its price or replace an existing observation.
                </p>
                {!review.candidates.length && (
                  <p>
                    No reliable candidates were submitted. Check the issues
                    below.
                  </p>
                )}
                {review.candidates.map((c) => (
                  <article
                    key={c.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <h3 className="text-lg font-semibold">
                      {c.report.identity?.name || "Unknown product"}
                    </h3>
                    <p>
                      {c.report.retailer} · AI suggestion:{" "}
                      {(c.report.match ?? "uncertain").replaceAll("_", " ")} ·{" "}
                      {c.report.identity?.brand || "Brand unknown"}
                    </p>
                    <p className="mt-2">
                      {c.report.price === null
                        ? "Price unknown"
                        : `${c.report.currency} ${c.report.price.toFixed(2)} reported, unverified`}
                    </p>
                    <p className="text-sm text-slate-600">
                      Observed{" "}
                      {new Date(c.report.observedAt).toLocaleString("en-AU")}
                      {c.report.identity?.packSize
                        ? ` · ${c.report.identity.packSize} ${c.report.identity.packUnit ?? ""}`
                        : c.report.identity?.packQuantity
                          ? ` · ${c.report.identity.packQuantity} units per package`
                          : " · Package size unknown"}
                    </p>
                    {c.comparableUnitPrice !== null && (
                      <p className="mt-2 text-sm">
                        Reported unit cost: AUD{" "}
                        {c.comparableUnitPrice.toFixed(4)} per {c.unitBasis}.
                        Compare only compatible products and quality.
                      </p>
                    )}
                    {c.report.promotion && (
                      <p className="mt-2 text-sm">
                        Reported conditions: {c.report.promotion}
                      </p>
                    )}
                    {c.validation === "AcceptedUnverified" ? (
                      <>
                        <a
                          className="mt-2 inline-block text-primary-700 underline"
                          href={c.report.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Review retailer source
                        </a>
                        <details className="mt-2">
                          <summary>Source evidence</summary>
                          <p className="mt-2 whitespace-pre-wrap text-sm">
                            {c.report.evidence}
                          </p>
                        </details>
                        <button
                          className={button + " mt-4"}
                          disabled={
                            busy ||
                            !listId ||
                            !Number.isInteger(quantity) ||
                            quantity < 1 ||
                            quantity > 10000
                          }
                          onClick={() =>
                            void run(async (signal) => {
                              const request = {
                                requestId: id(
                                  `select:${c.id}:${listId}:${quantity}`,
                                ),
                                candidateId: c.id,
                                listId: Number(listId),
                                quantity,
                              };
                              const result = await api<Receipt>(
                                "/research/select",
                                {
                                  method: "POST",
                                  headers: accountHeaders,
                                  signal,
                                  body: JSON.stringify(request),
                                },
                              );
                              if (signal.aborted) return;
                              await loadReview(review.id, signal);
                              if (!signal.aborted)
                                setNotice(
                                  result.replayed
                                    ? "This selection was already saved. Your list was kept unchanged."
                                    : result.status === "already_on_list"
                                      ? "This product is already on your list. Its quantity and notes were kept."
                                      : "Your selected product was added. Its reported price remains unverified.",
                                );
                            })
                          }
                        >
                          Choose and add to list
                        </button>
                      </>
                    ) : (
                      <p className="mt-3 text-amber-900">
                        Not available for selection:{" "}
                        {c.issues.join(", ").replaceAll("_", " ")}
                      </p>
                    )}
                  </article>
                ))}
                <h3 className="text-xl font-semibold">
                  Outstanding issues and outcomes
                </h3>
                {review.issues.map((i) => (
                  <article
                    key={i.id}
                    className="rounded-xl border border-slate-200 bg-white p-5"
                  >
                    <p className="font-semibold">
                      {i.retailer} · {i.code.replaceAll("_", " ")}
                      {i.target &&
                        ` · ${review.candidates.find((c) => c.report.key === i.target)?.report.identity?.name ?? "Affected product"}`}
                    </p>
                    <p className="mt-2">{i.detail}</p>
                    <p className="mt-2 text-sm">
                      {statusLabels[i.status] ?? i.status}
                      {i.resolution && `: ${i.resolution}`}
                    </p>
                    <label className="mt-3 block text-sm">
                      Action taken or remaining limitation
                      <input
                        maxLength={1000}
                        className={field}
                        value={reasons[i.id] ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          setReasons((v) => ({ ...v, [i.id]: e.target.value }))
                        }
                      />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {["Resolved", "CannotVerify", "Open"]
                        .filter((s) => s !== i.status)
                        .map((status) => (
                          <button
                            key={status}
                            className={secondary}
                            disabled={busy || !reasons[i.id]?.trim()}
                            onClick={() =>
                              void run(async (signal) => {
                                const reason = reasons[i.id].trim();
                                await api(`/research/issues/${i.id}`, {
                                  method: "PUT",
                                  headers: accountHeaders,
                                  signal,
                                  body: JSON.stringify({
                                    requestId: id(
                                      `issue:${i.id}:${i.revision}:${status}:${reason}`,
                                    ),
                                    expectedRevision: i.revision,
                                    status,
                                    reason,
                                  }),
                                });
                                if (!signal.aborted) {
                                  setReasons((value) => ({
                                    ...value,
                                    [i.id]: "",
                                  }));
                                  await loadReview(review.id, signal);
                                }
                              })
                            }
                          >
                            {status === "Resolved"
                              ? "Acknowledge as resolved"
                              : status === "CannotVerify"
                                ? "Keep outcome: cannot verify"
                                : "Reopen issue"}
                          </button>
                        ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Acknowledging an issue never verifies a reported price.
                    </p>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
