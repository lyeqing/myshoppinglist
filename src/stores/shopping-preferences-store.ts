import { createStore } from "zustand/vanilla";
import { api, ApiError } from "@/lib/api-client";
import type {
  Session,
  ShoppingPreferences,
  ShopLocationSummary,
  ShopLocationSearchResult,
} from "@/lib/api-types";

export function createShoppingPreferencesStore() {
  let generation = 0;
  let request: AbortController | undefined;
  let branchRequest: AbortController | undefined;
  let branchGeneration = 0;
  const clearSearch = () => {
    branchGeneration++;
    branchRequest?.abort();
    return { branchResult: null, branchSearching: false, branchError: "" };
  };
  return createStore<{
    session: Session | null;
    preferences: ShoppingPreferences | null;
    draft: ShoppingPreferences | null;
    branchShopId: number | null;
    branchQuery: string;
    branchResult: ShopLocationSearchResult | null;
    branchSearching: boolean;
    branchError: string;
    setBranchFilter: (shopId: number | null, query: string) => void;
    searchBranches: () => Promise<void>;
    addBranch: (branch: ShopLocationSummary) => void;
    removeBranch: (id: number) => void;
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
    setDifferentBrands: (enabled: boolean) => void;
    dispose: () => void;
  }>((set, get) => ({
    session: null,
    preferences: null,
    draft: null,
    branchShopId: null,
    branchQuery: "",
    branchResult: null,
    branchSearching: false,
    branchError: "",
    loading: true,
    saving: false,
    error: "",
    notice: "",
    unauthorized: false,
    conflict: false,
    dispose: () => {
      generation++;
      request?.abort();
      set({
        ...clearSearch(),
        saving: false,
        session: null,
        preferences: null,
        draft: null,
        branchShopId: null,
        branchQuery: "",
      });
    },
    load: async () => {
      const version = ++generation;
      request?.abort();
      request = new AbortController();
      set({
        ...clearSearch(),
        preferences: null,
        draft: null,
        branchShopId: null,
        branchQuery: "",
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
          set({
            preferences,
            draft: preferences,
            unauthorized: false,
            branchShopId:
              preferences.shops.find(
                (s) =>
                  s.isEnabled &&
                  preferences.availableShops.some((a) => a.id === s.shopId),
              )?.shopId ?? null,
          });
        }
      } catch (e) {
        if (
          version !== generation ||
          (e instanceof Error && e.name === "AbortError")
        )
          return;
        const unauthorized =
          e instanceof ApiError && [401, 403].includes(e.status);
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
        if (!state.draft || state.saving || state.loading || state.conflict)
          return {};
        const shops = state.draft.shops.some((s) => s.shopId === shopId)
          ? state.draft.shops.map((s) =>
              s.shopId === shopId ? { ...s, isEnabled } : s,
            )
          : [...state.draft.shops, { shopId, isEnabled }];
        const branchShopId = shops.some(
          (s) => s.shopId === state.branchShopId && s.isEnabled,
        )
          ? state.branchShopId
          : (shops.find((s) => s.isEnabled)?.shopId ?? null);
        return {
          ...clearSearch(),
          branchShopId,
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
        s.draft && !s.saving && !s.loading && !s.conflict
          ? { draft: { ...s.draft, compareOnlyPreferredShops }, notice: "" }
          : {},
      ),
    setDifferentPackSizes: (includeDifferentPackSizes) =>
      set((s) =>
        s.draft && !s.saving && !s.loading && !s.conflict
          ? { draft: { ...s.draft, includeDifferentPackSizes }, notice: "" }
          : {},
      ),
    setDifferentBrands: (includeDifferentBrands) =>
      set((s) =>
        s.draft && !s.saving && !s.loading && !s.conflict
          ? { draft: { ...s.draft, includeDifferentBrands }, notice: "" }
          : {},
      ),
    setBranchFilter: (branchShopId, branchQuery) => {
      if (get().saving || get().loading || get().conflict || !get().draft)
        return;
      set({ ...clearSearch(), branchShopId, branchQuery });
    },
    searchBranches: async () => {
      const state = get();
      if (!state.draft || state.saving || state.loading || state.conflict)
        return;
      const shopId = state.branchShopId,
        query = state.branchQuery.trim();
      if (
        !shopId ||
        !state.draft.shops.some((s) => s.shopId === shopId && s.isEnabled) ||
        query.length === 1 ||
        state.branchQuery.length > 100
      ) {
        set({
          branchError:
            "Choose an enabled supermarket and use at least two search characters, or leave the search blank.",
        });
        return;
      }
      const cleared = clearSearch(),
        version = branchGeneration,
        sessionVersion = generation;
      const controller = (branchRequest = new AbortController());
      set({ ...cleared, branchSearching: true });
      try {
        const params = new URLSearchParams({ shopId: String(shopId) });
        if (query) params.set("search", query);
        const result = await api<ShopLocationSearchResult>(
          `/shop-locations?${params}`,
          { signal: controller.signal },
        );
        if (version === branchGeneration && sessionVersion === generation)
          set({ branchResult: result });
      } catch (error) {
        if (version !== branchGeneration || sessionVersion !== generation)
          return;
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          get().dispose();
          set({ unauthorized: true, loading: false, error: error.message });
        } else
          set({
            branchError:
              error instanceof Error
                ? error.message
                : "Could not find branches. Try again.",
          });
      } finally {
        if (version === branchGeneration && sessionVersion === generation)
          set({ branchSearching: false });
      }
    },
    addBranch: (branch) => {
      const state = get(),
        draft = state.draft;
      if (
        !draft ||
        state.saving ||
        state.loading ||
        state.conflict ||
        branch.shopId !== state.branchShopId ||
        !draft.shops.some((s) => s.shopId === branch.shopId && s.isEnabled) ||
        !state.branchResult?.items.some((b) => b.id === branch.id)
      )
        return;
      const branches = draft.branches ?? [];
      if (branches.some((b) => b.location.id === branch.id)) return;
      if (branches.length >= 100) {
        set({
          branchError:
            "You can save up to 100 branches. Remove a branch before adding another.",
        });
        return;
      }
      set({
        draft: {
          ...draft,
          branches: [
            ...branches,
            { location: branch, isAvailable: true, unavailableReason: null },
          ],
        },
        notice: "",
        error: "",
      });
    },
    removeBranch: (id) => {
      const state = get();
      if (!state.draft || state.saving || state.loading || state.conflict)
        return;
      set({
        draft: {
          ...state.draft,
          branches: (state.draft.branches ?? []).filter(
            (b) => b.location.id !== id,
          ),
        },
        notice: "",
        error: "",
        branchError: "",
      });
    },
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
      set({ ...clearSearch(), saving: true, error: "", notice: "" });
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
              ...(draft.branches !== undefined
                ? {
                    branches: draft.branches.map((b) => ({
                      shopId: b.location.shopId,
                      shopLocationId: b.location.id,
                    })),
                  }
                : {}),
              expectedUpdatedDate: draft.updatedDate,
            }),
          },
        );
        if (version === generation)
          set({
            preferences,
            draft: preferences,
            notice:
              "My Stores saved. Supermarket settings apply to comparisons and price refreshes. Saved branches do not enable branch-specific prices.",
          });
      } catch (e) {
        if (
          version !== generation ||
          (e instanceof Error && e.name === "AbortError")
        )
          return;
        const unauthorized =
          e instanceof ApiError && [401, 403].includes(e.status);
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
