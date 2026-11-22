"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api-client";
import ServiceUnavailable from "./service-unavailable";

export default function AuthAvailabilityBoundary({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const unavailable = () => setError("The account service could not be reached or returned an unexpected response.");
    window.addEventListener("myshoppinglist-auth-unavailable", unavailable);
    return () => {
      window.removeEventListener("myshoppinglist-auth-unavailable", unavailable);
      request.current?.abort();
    };
  }, []);
  async function retry() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      try { await api("/auth/me", { signal: controller.signal }); }
      catch (cause) { if (!(cause instanceof ApiError && cause.status === 401)) throw cause; }
      if (!controller.signal.aborted) setError(null);
    } catch {
      if (!controller.signal.aborted) setError("The account service is still unavailable. Please try again later.");
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return error === null ? children : <ServiceUnavailable error={error} busy={busy} retry={() => void retry()} />;
}
