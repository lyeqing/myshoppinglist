"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import SocialSignInButtons, {
  providerName,
  type SocialProvider,
} from "./social-sign-in-buttons";

type Methods = {
  hasPassword: boolean;
  canAddPassword: boolean;
  emailDeliveryAvailable: boolean;
  recentlyAuthenticated: boolean;
  providers: SocialProvider[];
};
export default function SignInMethods({
  accountId,
  onPasswordStatus,
}: {
  accountId: number;
  onPasswordStatus: (value: boolean) => void;
}) {
  const [data, setData] = useState<Methods | null>(null),
    [password, setPassword] = useState(""),
    [email, setEmail] = useState("");
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [disconnect, setDisconnect] = useState("");
  const epoch = useRef(0),
    posting = useRef(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const generation = epoch.current;
      try {
        const value = await api<Methods>("/auth/social/methods", { signal });
        if (generation === epoch.current && !signal?.aborted) {
          setData(value);
          onPasswordStatus(value.hasPassword);
        }
      } catch (e) {
        if (generation === epoch.current && !signal?.aborted)
          setError(
            e instanceof Error ? e.message : "Could not load sign-in methods.",
          );
      }
    },
    [onPasswordStatus],
  );
  const invalidate = useCallback(() => {
    epoch.current++;
    posting.current = false;
  }, []);
  useEffect(() => {
    invalidate();
    const controller = new AbortController();
    const generation = epoch.current;
    api<Methods>("/auth/social/methods", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted && generation === epoch.current) {
          setData(value);
          onPasswordStatus(value.hasPassword);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted && generation === epoch.current)
          setError(
            e instanceof Error ? e.message : "Could not load sign-in methods.",
          );
      });
    return () => {
      invalidate();
      controller.abort();
    };
  }, [accountId, onPasswordStatus, invalidate]);
  async function change(
    action: "reauthenticate" | "disconnect" | "password/start",
    extra: object,
  ) {
    if (posting.current) return;
    posting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const generation = epoch.current;
    try {
      await api(`/auth/social/${action}`, {
        method: "POST",
        body: JSON.stringify({ expectedAccountId: accountId, ...extra }),
      });
      if (generation !== epoch.current) return;
      setPassword("");
      setDisconnect("");
      if (action === "disconnect") {
        window.dispatchEvent(new Event("myshoppinglist-session-changed"));
        return;
      }
      setMessage(
        action === "reauthenticate"
          ? "Identity verified. You can now change your sign-in methods for five minutes."
          : "Check your email. Open the verification link in this signed-in browser to choose a password.",
      );
      await load();
    } catch (e) {
      if (generation === epoch.current) {
        setError(
          e instanceof Error ? e.message : "Could not update sign-in methods.",
        );
        if (e instanceof ApiError && (e.status === 401 || e.status === 409))
          window.dispatchEvent(new Event("myshoppinglist-session-changed"));
      }
    } finally {
      if (generation === epoch.current) {
        posting.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
      aria-labelledby="signin-methods-title"
    >
      <h2 id="signin-methods-title" className="text-xl font-semibold">
        Sign-in methods
      </h2>
      <p className="text-sm text-slate-600">
        All connected methods open the same account, lists and subscription.
        Accounts are never combined automatically.
      </p>
      {!data ? (
        <>
          <p role="status">Loading sign-in methods…</p>
          {error && (
            <button
              type="button"
              onClick={() => {
                setError("");
                void load();
              }}
              className="min-h-11 underline"
            >
              Retry
            </button>
          )}
        </>
      ) : (
        <>
          <p>Email/password — {data.hasPassword ? "Active" : "Not set up"}</p>
          <ul className="space-y-3">
            {data.providers.map((p) => (
              <li
                key={p.provider}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
              >
                <span>
                  {providerName(p.provider)} —{" "}
                  {p.connected ? "Connected" : "Not connected"}
                  {!p.available ? " (currently unavailable)" : ""}
                </span>
                {p.connected && (
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !data.recentlyAuthenticated ||
                      (!data.hasPassword &&
                        !data.providers.some(
                          (other) =>
                            other.provider !== p.provider &&
                            other.connected &&
                            other.available,
                        ))
                    }
                    onClick={() => setDisconnect(p.provider)}
                    className="min-h-11 font-semibold underline disabled:opacity-50"
                  >
                    Disconnect {providerName(p.provider)}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!data.hasPassword &&
            data.providers.filter((p) => p.connected && p.available).length <
              2 && (
              <p className="text-sm text-slate-600">
                Keep your last available provider connected until you add
                another sign-in method.
              </p>
            )}
          {!data.recentlyAuthenticated ? (
            <div className="space-y-3 rounded-xl bg-slate-50 p-4">
              <h3 className="font-semibold">
                Verify it’s you before making changes
              </h3>
              {data.hasPassword && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void change("reauthenticate", { password });
                  }}
                  className="space-y-3"
                >
                  <label className="block text-sm">
                    Password to verify your identity
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      maxLength={1024}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="mt-2 block w-full rounded-xl border px-3 py-3"
                    />
                  </label>
                  <button
                    disabled={busy}
                    className="min-h-11 rounded-xl bg-primary-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
                  >
                    Verify password
                  </button>
                </form>
              )}
              {data.providers.some((p) => p.connected && p.available) && (
                <SocialSignInButtons
                  purpose="reauthenticate"
                  accountId={accountId}
                  providers={data.providers.filter(
                    (p) => p.connected && p.available,
                  )}
                  disabled={busy}
                />
              )}
            </div>
          ) : (
            <>
              <p role="status" className="text-sm text-emerald-800">
                Identity verified recently. Security changes require another
                verification after five minutes.
              </p>
              <SocialSignInButtons
                purpose="link"
                accountId={accountId}
                providers={data.providers.filter((p) => !p.connected)}
                disabled={busy}
              />
              {data.canAddPassword &&
                (data.emailDeliveryAvailable ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void change("password/start", { email });
                    }}
                    className="space-y-3 border-t pt-4"
                  >
                    <h3 className="font-semibold">Add email/password</h3>
                    <label className="block text-sm">
                      Email to verify
                      <input
                        type="email"
                        required
                        maxLength={320}
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="mt-2 block w-full rounded-xl border px-3 py-3"
                      />
                    </label>
                    <button
                      disabled={busy}
                      className="min-h-11 rounded-xl border px-4 py-2 font-semibold"
                    >
                      Send verification link
                    </button>
                  </form>
                ) : (
                  <p className="text-sm text-slate-600">
                    Email verification is temporarily unavailable. Keep using
                    your connected providers.
                  </p>
                ))}
            </>
          )}
          {disconnect && (
            <div
              role="group"
              aria-label="Confirm provider disconnect"
              className="space-y-3 rounded-xl bg-amber-50 p-4"
            >
              <p>
                Disconnect {providerName(disconnect)} and sign out on all
                devices? Connected AI apps and extensions will also be
                disconnected. Your lists and subscription are kept.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void change("disconnect", { provider: disconnect })
                }
                className="min-h-11 rounded-xl border px-4 font-semibold"
              >
                Disconnect and sign out
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDisconnect("")}
                className="ml-3 min-h-11 underline"
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-800">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-800">
          {error}
        </p>
      )}
    </section>
  );
}
