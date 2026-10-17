import { createStore } from "zustand/vanilla";
import { api, ApiError } from "@/lib/api-client";
import type {
  Session,
  ShoppingPreferences,
  ShopLocationDetails,
  ShopLocationCreateRequest,
  ShopLocationAdminDetail,
  ShopLocationAdminSearchResult,
} from "@/lib/api-types";

type Draft = ShopLocationCreateRequest & { confirmed: boolean };
type State = {
  accountId: number | null;
  retailers: ShoppingPreferences["availableShops"];
  filterShopId: number | null;
  query: string;
  result: ShopLocationAdminSearchResult | null;
  selectedId: number | null;
  detail: ShopLocationAdminDetail | null;
  draft: Draft | null;
  initialising: boolean;
  searching: boolean;
  loading: boolean;
  saving: boolean;
  denied: boolean;
  conflict: boolean;
  error: string;
  notice: string;
  initialise: () => Promise<void>;
  dispose: () => void;
  setFilters: (shopId: number | null, query: string) => void;
  search: () => Promise<void>;
  newBranch: () => void;
  edit: (id: number) => Promise<void>;
  closeEditor: () => void;
  setField: <K extends keyof ShopLocationDetails>(
    key: K,
    value: ShopLocationDetails[K],
  ) => void;
  setSource: (sourceReference: string) => void;
  setEvidence: (evidence: string) => void;
  setConfirmed: (confirmed: boolean) => void;
  save: () => Promise<void>;
};
const base = "/admin/shop-locations";
const clean = () => ({
  accountId: null,
  retailers: [],
  filterShopId: null,
  query: "",
  result: null,
  selectedId: null,
  detail: null,
  draft: null,
  initialising: false,
  searching: false,
  loading: false,
  saving: false,
  denied: false,
  conflict: false,
  error: "",
  notice: "",
});
function editDraft(detail: ShopLocationAdminDetail): Draft {
  const b = detail.branch,
    l = b.location;
  return {
    details: {
      shopId: l.shopId,
      storeCode: l.storeCode ?? "",
      name: l.name,
      address1: l.address1 ?? "",
      address2: l.address2 ?? "",
      suburb: l.suburb ?? "",
      state: l.state ?? "",
      postcode: l.postcode ?? "",
      isActive: b.isActive,
    },
    sourceReference: b.sourceReference ?? "",
    evidence: "",
    confirmed: false,
  };
}
function searchPath(shopId: number | null, query: string) {
  const params = new URLSearchParams();
  if (shopId !== null) params.set("shopId", String(shopId));
  if (query.trim()) params.set("search", query.trim());
  return `${base}?${params}`;
}
export function createAdminShopLocationsStore() {
  let epoch = 0,
    searchVersion = 0,
    detailVersion = 0;
  const controllers: Partial<
    Record<"init" | "search" | "detail" | "save", AbortController>
  > = {};
  const abortAll = () => Object.values(controllers).forEach((c) => c?.abort());
  return createStore<State>((set, get) => {
    const fail = (error: unknown) => {
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        epoch++;
        searchVersion++;
        detailVersion++;
        abortAll();
        set({
          ...clean(),
          denied: true,
          error:
            "Administrator access required. Sign in with an administrator account.",
        });
      } else
        set({
          error:
            error instanceof Error
              ? error.message
              : "Unable to complete this request.",
        });
    };
    const editable = () =>
      get().draft && !get().saving && !get().conflict && !!get().accountId;
    return {
      ...clean(),
      dispose: () => {
        epoch++;
        searchVersion++;
        detailVersion++;
        abortAll();
        set(clean());
      },
      initialise: async () => {
        get().dispose();
        const sessionVersion = epoch;
        const controller = (controllers.init = new AbortController());
        set({ initialising: true });
        try {
          const session = await api<Session>("/auth/me", {
            signal: controller.signal,
          });
          if (sessionVersion !== epoch) return;
          const preferences = await api<ShoppingPreferences>(
            "/account/shopping-preferences",
            { signal: controller.signal },
          );
          if (sessionVersion !== epoch) return;
          if (preferences.accountId !== session.account.id)
            throw new ApiError(
              409,
              "Your account changed. Retry the access check.",
            );
          const retailer = preferences.availableShops[0];
          if (!retailer)
            throw new ApiError(
              400,
              "No active retailers are available. Restore a retailer before maintaining branches.",
            );
          const result = await api<ShopLocationAdminSearchResult>(
            searchPath(retailer.id, ""),
            { signal: controller.signal },
          );
          if (sessionVersion === epoch)
            set({
              accountId: session.account.id,
              retailers: preferences.availableShops,
              filterShopId: retailer.id,
              result,
            });
        } catch (error) {
          if (sessionVersion === epoch) fail(error);
        } finally {
          if (sessionVersion === epoch) set({ initialising: false });
        }
      },
      setFilters: (filterShopId, query) => {
        if (get().saving || !get().accountId) return;
        searchVersion++;
        controllers.search?.abort();
        set({ filterShopId, query, result: null, searching: false, error: "" });
      },
      search: async () => {
        if (!get().accountId) return;
        const { filterShopId, query } = get();
        if (
          query.length > 100 ||
          query.trim().length === 1 ||
          (filterShopId === null && query.trim().length < 2)
        ) {
          set({
            error: "Select a retailer or enter at least two search characters.",
          });
          return;
        }
        const version = ++searchVersion,
          sessionVersion = epoch;
        controllers.search?.abort();
        const controller = (controllers.search = new AbortController());
        set({ searching: true, result: null, error: "" });
        try {
          const result = await api<ShopLocationAdminSearchResult>(
            searchPath(filterShopId, query),
            { signal: controller.signal },
          );
          if (version === searchVersion && sessionVersion === epoch)
            set({ result });
        } catch (error) {
          if (version === searchVersion && sessionVersion === epoch)
            fail(error);
        } finally {
          if (version === searchVersion && sessionVersion === epoch)
            set({ searching: false });
        }
      },
      closeEditor: () => {
        if (get().saving) return;
        detailVersion++;
        controllers.detail?.abort();
        set({
          selectedId: null,
          detail: null,
          draft: null,
          loading: false,
          conflict: false,
          error: "",
          notice: "",
        });
      },
      newBranch: () => {
        if (get().saving || !get().accountId) return;
        get().closeEditor();
        set({
          draft: {
            details: {
              shopId: get().filterShopId ?? get().retailers[0].id,
              storeCode: "",
              name: "",
              address1: "",
              address2: "",
              suburb: "",
              state: "",
              postcode: "",
              isActive: true,
            },
            sourceReference: "",
            evidence: "",
            confirmed: false,
          },
        });
      },
      edit: async (id) => {
        if (get().saving || !get().accountId) return;
        const version = ++detailVersion,
          sessionVersion = epoch;
        controllers.detail?.abort();
        const controller = (controllers.detail = new AbortController());
        set({
          selectedId: id,
          detail: null,
          draft: null,
          loading: true,
          conflict: false,
          error: "",
          notice: "",
        });
        try {
          const detail = await api<ShopLocationAdminDetail>(`${base}/${id}`, {
            signal: controller.signal,
          });
          if (version === detailVersion && sessionVersion === epoch)
            set({ detail, draft: editDraft(detail) });
        } catch (error) {
          if (version === detailVersion && sessionVersion === epoch)
            fail(error);
        } finally {
          if (version === detailVersion && sessionVersion === epoch)
            set({ loading: false });
        }
      },
      setField: (key, value) => {
        if (!editable()) return;
        if (
          get().selectedId !== null &&
          (key === "shopId" ||
            (key === "storeCode" &&
              get().detail?.branch.location.storeCode !== null))
        )
          return;
        set({
          draft: {
            ...get().draft!,
            details: { ...get().draft!.details, [key]: value },
            confirmed: false,
          },
          notice: "",
        });
      },
      setSource: (sourceReference) => {
        if (editable())
          set({
            draft: { ...get().draft!, sourceReference, confirmed: false },
            notice: "",
          });
      },
      setEvidence: (evidence) => {
        if (editable())
          set({ draft: { ...get().draft!, evidence }, notice: "" });
      },
      setConfirmed: (confirmed) => {
        if (editable())
          set({ draft: { ...get().draft!, confirmed }, notice: "" });
      },
      save: async () => {
        const state = get(),
          draft = state.draft;
        if (
          !draft ||
          !state.accountId ||
          state.saving ||
          state.loading ||
          state.conflict ||
          !draft.confirmed ||
          !draft.sourceReference.trim() ||
          !draft.evidence.trim() ||
          draft.sourceReference.length > 1000 ||
          draft.evidence.length > 2000
        )
          return;
        const sessionVersion = epoch,
          version = detailVersion,
          id = state.selectedId;
        const controller = (controllers.save = new AbortController());
        const body: ShopLocationCreateRequest & {
          expectedUpdatedDate?: string;
        } = {
          details: { ...draft.details },
          sourceReference: draft.sourceReference.trim(),
          evidence: draft.evidence.trim(),
          ...(state.detail
            ? { expectedUpdatedDate: state.detail.branch.updatedDate }
            : {}),
        };
        set({ saving: true, error: "", notice: "" });
        try {
          const identity = await api<Session>("/auth/me", {
            signal: controller.signal,
          });
          if (sessionVersion !== epoch || version !== detailVersion) return;
          if (identity.account.id !== state.accountId) {
            await get().initialise();
            set({
              error:
                "Your account changed. Select and review the branch again before saving.",
            });
            return;
          }
          const detail = await api<ShopLocationAdminDetail>(
            id === null ? base : `${base}/${id}`,
            {
              method: id === null ? "POST" : "PUT",
              body: JSON.stringify(body),
              signal: controller.signal,
            },
          );
          if (sessionVersion !== epoch || version !== detailVersion) return;
          set({
            selectedId: detail.branch.location.id,
            detail,
            draft: editDraft(detail),
            conflict: false,
            notice:
              id === null
                ? "Verified branch created."
                : !detail.branch.isActive
                  ? "Branch retired. It is hidden from customers; existing records are preserved."
                  : state.detail?.branch.isActive === false
                    ? "Branch reactivated."
                    : "Reviewed branch changes saved.",
          });
          await get().search();
        } catch (error) {
          if (sessionVersion === epoch && version === detailVersion) {
            fail(error);
            if (
              error instanceof ApiError &&
              error.status === 409 &&
              id !== null
            )
              set({ conflict: true, draft: null });
          }
        } finally {
          if (sessionVersion === epoch && version === detailVersion)
            set({ saving: false });
        }
      },
    };
  });
}
