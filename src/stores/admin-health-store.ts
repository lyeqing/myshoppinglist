import { createStore } from "zustand/vanilla";
import { api, ApiError } from "@/lib/api-client";

export interface AdminHealth {
  checkedAt: string;
  outcomesSince: string;
  blockedWindowMinutes: number;
  maxConcurrentTasks: number;
  retailers: {
    code: string;
    name: string;
    waiting: number;
    processing: number;
    expiredLeases: number;
    failed: number;
    oldestOutstandingCreatedAt: string | null;
    completedLast24Hours: number;
    failedLast24Hours: number;
    completionPercent: number | null;
    recentBlockedReports: number;
    workloadStatus: "Running" | "Paused" | "TrialRunning" | "AwaitingTrial";
    pausedUntil: string | null;
    trialExpiresAt: string | null;
    commonFailures: { code: string; count: number }[];
  }[];
}

export function createAdminHealthStore() {
  let controller: AbortController | undefined;
  let generation = 0;
  return createStore<{
    data: AdminHealth | null;
    busy: boolean;
    error: string;
    denied: boolean;
    load: () => Promise<void>;
    cancel: () => void;
    reset: () => void;
  }>((set, get) => ({
    data: null,
    busy: false,
    error: "",
    denied: false,
    cancel: () => {
      generation++;
      controller?.abort();
      controller = undefined;
      set({ busy: false });
    },
    reset: () => {
      get().cancel();
      set({ data: null, error: "", denied: false });
    },
    load: async () => {
      if (get().busy) return;
      const version = ++generation;
      controller = new AbortController();
      set({ busy: true, error: "" });
      try {
        const data = await api<AdminHealth>("/admin/health", {
          signal: controller.signal,
        });
        if (version === generation) set({ data, denied: false });
      } catch (error) {
        if (version !== generation) return;
        const denied =
          error instanceof ApiError && [401, 403].includes(error.status);
        set({
          error: denied
            ? "Administrator access required. Sign in with an administrator account."
            : error instanceof Error
              ? error.message
              : "Unable to load health information.",
          denied,
          ...(denied ? { data: null } : {}),
        });
      } finally {
        if (version === generation) {
          controller = undefined;
          set({ busy: false });
        }
      }
    },
  }));
}
