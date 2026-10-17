import { createStore } from "zustand/vanilla";
import { api, ApiError } from "@/lib/api-client";
import type { Session, ShoppingPreferences } from "@/lib/api-types";

export function createShoppingPreferencesStore() {
  let generation = 0;
  let request: AbortController | undefined;
  return createStore<{
    session: Session | null;
    preferences: ShoppingPreferences | null;
    draft: ShoppingPreferences | null;
    loading: boolean;
    saving: boolean;
    error: string;
    notice: string;
    unauthorized: boolean;
    conflict: boolean;
    load: () => Promise<void>;
    save: () => Promise<void>;
    toggleShop: (id: number, enabled: boolean) => void;
    setPreferredOnly: (enabled: boolean) => void;
    setDifferentPackSizes: (enabled: boolean) => void;
    dispose: () => void;
  }>((set, get) => ({
    session: null,
    preferences: null,
    draft: null,
    loading: true,
    saving: false,
    error: "",
    notice: "",
    unauthorized: false,
    conflict: false,
    dispose: () => {
      generation++;
      request?.abort();
      set({ saving: false });
    },
    load: async () => {
      const version = ++generation;
      request?.abort();
      request = new AbortController();
      set({
        loading: true,
        saving: false,
        error: "",
        notice: "",
        conflict: false,
      });
      try {
        const session = await api<Session>("/auth/me", {
          signal: request.signal,
        });
        if (version !== generation) return;
        if (get().session?.account.id !== session.account.id)
          set({ preferences: null, draft: null });
        set({ session });
        const preferences = await api<ShoppingPreferences>(
          "/account/shopping-preferences",
          { signal: request.signal },
        );
        if (version === generation) {
          if (preferences.accountId !== session.account.id) {
            set({ preferences: null, draft: null });
            throw new ApiError(
              409,
              "Your account changed. Reload settings before editing.",
            );
          }
          set({ preferences, draft: preferences, unauthorized: false });
        }
      } catch (e) {
        if (
          version !== generation ||
          (e instanceof Error && e.name === "AbortError")
        )
          return;
        const unauthorized = e instanceof ApiError && e.status === 401;
        set({
          error: e instanceof Error ? e.message : "Could not load settings.",
          unauthorized,
          ...(unauthorized
            ? { session: null, preferences: null, draft: null }
            : {}),
        });
      } finally {
        if (version === generation) set({ loading: false });
      }
    },
    toggleShop: (shopId, isEnabled) =>
      set((state) => {
        if (!state.draft || state.saving || state.loading) return {};
        const shops = state.draft.shops.some((s) => s.shopId === shopId)
          ? state.draft.shops.map((s) =>
              s.shopId === shopId ? { ...s, isEnabled } : s,
            )
          : [...state.draft.shops, { shopId, isEnabled }];
        return {
          draft: {
            ...state.draft,
            shops,
            compareOnlyPreferredShops:
              !state.draft.shops.length && isEnabled
                ? true
                : state.draft.compareOnlyPreferredShops,
          },
          notice: "",
        };
      }),
    setPreferredOnly: (compareOnlyPreferredShops) =>
      set((s) =>
        s.draft && !s.saving && !s.loading
          ? { draft: { ...s.draft, compareOnlyPreferredShops }, notice: "" }
          : {},
      ),
    setDifferentPackSizes: (includeDifferentPackSizes) =>
      set((s) =>
        s.draft && !s.saving && !s.loading
          ? { draft: { ...s.draft, includeDifferentPackSizes }, notice: "" }
          : {},
      ),
    save: async () => {
      const draft = get().draft;
      if (!draft || get().saving || get().loading || get().conflict) return;
      if (
        draft.compareOnlyPreferredShops &&
        !draft.shops.some((s) => s.isEnabled)
      ) {
        set({
          error:
            "Choose at least one store, or turn off Compare only my stores.",
        });
        return;
      }
      const version = ++generation;
      request?.abort();
      request = new AbortController();
      set({ saving: true, error: "", notice: "" });
      try {
        // Check identity again before writing a draft left open in another browser tab.
        const session = await api<Session>("/auth/me", {
          signal: request.signal,
        });
        if (version !== generation) return;
        if (session.account.id !== get().session?.account.id) {
          set({ session, preferences: null, draft: null });
          await get().load();
          return;
        }
        const preferences = await api<ShoppingPreferences>(
          "/account/shopping-preferences",
          {
            method: "PUT",
            signal: request.signal,
            body: JSON.stringify({
              expectedAccountId: draft.accountId,
              compareOnlyPreferredShops: draft.compareOnlyPreferredShops,
              includeDifferentPackSizes: draft.includeDifferentPackSizes,
              includeDifferentBrands: draft.includeDifferentBrands,
              shops: draft.shops,
              expectedUpdatedDate: draft.updatedDate,
            }),
          },
        );
        if (version === generation)
          set({
            preferences,
            draft: preferences,
            notice:
              "My Stores saved. Comparisons and price refreshes now use these settings.",
          });
      } catch (e) {
        if (
          version !== generation ||
          (e instanceof Error && e.name === "AbortError")
        )
          return;
        const unauthorized = e instanceof ApiError && e.status === 401;
        set({
          error: e instanceof Error ? e.message : "Could not save settings.",
          unauthorized,
          conflict: e instanceof ApiError && e.status === 409,
          ...(unauthorized
            ? { session: null, preferences: null, draft: null }
            : {}),
        });
      } finally {
        if (version === generation) set({ saving: false });
      }
    },
  }));
}
