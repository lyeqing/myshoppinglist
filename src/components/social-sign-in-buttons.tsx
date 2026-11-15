"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";

export type SocialProvider = {
  provider: string;
  available: boolean;
  connected?: boolean;
};
export const providerName = (provider: string) =>
  ({ google: "Google", facebook: "Facebook", microsoft: "Microsoft" })[
    provider as "google" | "facebook" | "microsoft"
  ] ?? "Provider";

function ProviderMark({ provider }: { provider: string }) {
  if (provider === "google")
    return (
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="10 10 20 20"
        className="shrink-0"
      >
        {/* Standard G paths from Google's pre-approved branding asset; no shape/color changes. */}
        <path
          d="M29.6 20.2273C29.6 19.5182 29.5364 18.8364 29.4182 18.1818H20V22.05H25.3818C25.15 23.3 24.4455 24.3591 23.3864 25.0682V27.5773H26.6182C28.5091 25.8364 29.6 23.2727 29.6 20.2273Z"
          fill="#4285F4"
        />
        <path
          d="M20 30C22.7 30 24.9636 29.1045 26.6181 27.5773L23.3863 25.0682C22.4909 25.6682 21.3454 26.0227 20 26.0227C17.3954 26.0227 15.1909 24.2636 14.4045 21.9H11.0636V24.4909C12.7091 27.7591 16.0909 30 20 30Z"
          fill="#34A853"
        />
        <path
          d="M14.4045 21.9C14.2045 21.3 14.0909 20.6591 14.0909 20C14.0909 19.3409 14.2045 18.7 14.4045 18.1V15.5091H11.0636C10.3864 16.8591 10 18.3864 10 20C10 21.6136 10.3864 23.1409 11.0636 24.4909L14.4045 21.9Z"
          fill="#FBBC04"
        />
        <path
          d="M20 13.9773C21.4681 13.9773 22.7863 14.4818 23.8227 15.4727L26.6909 12.6045C24.9591 10.9909 22.6954 10 20 10C16.0909 10 12.7091 12.2409 11.0636 15.5091L14.4045 18.1C15.1909 15.7364 17.3954 13.9773 20 13.9773Z"
          fill="#E94235"
        />
      </svg>
    );
  if (provider === "microsoft")
    return (
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 21 21"
        className="shrink-0"
      >
        <path fill="#f25022" d="M1 1h9v9H1z" />
        <path fill="#7fba00" d="M11 1h9v9h-9z" />
        <path fill="#00a4ef" d="M1 11h9v9H1z" />
        <path fill="#ffb900" d="M11 11h9v9h-9z" />
      </svg>
    );
  return null;
}

export default function SocialSignInButtons({
  purpose = "signin",
  accountId,
  providers,
  disabled = false,
}: {
  purpose?: "signin" | "link" | "reauthenticate";
  accountId?: number;
  providers?: SocialProvider[];
  disabled?: boolean;
}) {
  const [loaded, setAvailable] = useState<SocialProvider[]>([]);
  const available = providers ?? loaded;
  const [loading, setLoading] = useState(!providers),
    [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false),
    [cleared, setCleared] = useState(false);
  const posting = useRef(false);
  const pendingRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const requests = pendingRequest;
    return () => requests.current?.abort();
  }, []);
  useEffect(() => {
    if (providers) return;
    const controller = new AbortController();
    api<unknown>("/auth/social/providers", {
      signal: controller.signal,
    })
      .then((value) => {
        if (
          !Array.isArray(value) ||
          value.some(
            (p) =>
              !p ||
              typeof p !== "object" ||
              !["google", "facebook", "microsoft"].includes(p.provider) ||
              typeof p.available !== "boolean",
          )
        )
          throw new Error("Sign-in options unavailable.");
        if (!controller.signal.aborted) setAvailable(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Social sign-in is unavailable. You can still use email/password or a trial.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [providers]);
  async function start(provider: string) {
    if (posting.current || disabled) return;
    posting.current = true;
    setPending(provider);
    setError("");
    const controller = new AbortController();
    pendingRequest.current = controller;
    try {
      const response = await api<{ authorizationUrl: string }>(
        "/auth/social/start",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            provider,
            purpose,
            expectedAccountId: cleared ? null : (accountId ?? null),
          }),
        },
      );
      if (!controller.signal.aborted)
        window.location.assign(response.authorizationUrl);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof ApiError && e.status === 401 && purpose === "signin")
        setExpired(true);
      setError(
        e instanceof Error ? e.message : "Sign-in could not start. Try again.",
      );
      posting.current = false;
      setPending("");
    }
  }
  async function clearExpired() {
    if (posting.current) return;
    posting.current = true;
    setPending("reset");
    const controller = new AbortController();
    pendingRequest.current = controller;
    try {
      await api<void>("/auth/reset-expired", {
        method: "POST",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setExpired(false);
      setCleared(true);
      setError(
        "Expired session cleared. Choose a provider to sign in or create a new account. An expired trial cannot be saved.",
      );
      window.dispatchEvent(new Event("myshoppinglist-session-changed"));
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(
        e instanceof Error ? e.message : "Could not check the expired session.",
      );
    } finally {
      if (!controller.signal.aborted) {
        posting.current = false;
        setPending("");
      }
    }
  }
  return (
    <div
      className="space-y-3"
      aria-label={
        purpose === "signin" ? "Social sign-in" : "Provider verification"
      }
    >
      {loading ? (
        <p role="status" className="text-sm text-slate-600">
          Checking sign-in options…
        </p>
      ) : (
        available.map((p) => (
          <button
            key={p.provider}
            type="button"
            disabled={disabled || expired || !!pending || !p.available}
            onClick={() => start(p.provider)}
            className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-[#747775] bg-white px-3 py-3 text-sm font-medium text-[#1f1f1f] hover:bg-slate-50 disabled:opacity-50"
          >
            <ProviderMark provider={p.provider} />
            {pending === p.provider
              ? "Opening provider…"
              : `${purpose === "signin" ? "Continue with" : purpose === "link" ? "Connect" : "Verify with"} ${providerName(p.provider)}${!p.available ? " — unavailable" : ""}`}
          </button>
        ))
      )}
      {!loading &&
        available.length > 0 &&
        !available.some((p) => p.available) &&
        purpose === "signin" && (
          <p className="text-sm text-slate-600">
            Social sign-in is not available yet. Email/password and the
            three-hour trial are still available.
          </p>
        )}
      {error && (
        <p role="alert" className="text-sm text-amber-800">
          {error}
        </p>
      )}
      {expired && (
        <button
          type="button"
          disabled={!!pending}
          onClick={() => void clearExpired()}
          className="min-h-11 text-sm font-semibold underline"
        >
          Clear expired session and start again
        </button>
      )}
    </div>
  );
}
