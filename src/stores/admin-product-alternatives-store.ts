import { createStore } from "zustand/vanilla";
import { api, ApiError } from "@/lib/api-client";
import type {
  AdminAlternativeProductSearchItem,
  AdminAlternativeProductSearchResult,
  BrandAlternativeReviewContext,
  BrandAlternativeReviewRequest,
  BrandAlternativeReviewResponse,
  Session,
} from "@/lib/api-types";

type Slot = "first" | "second";
type Picker = {
  query: string;
  result: AdminAlternativeProductSearchResult | null;
  selected: AdminAlternativeProductSearchItem | null;
  busy: boolean;
};
const picker = (): Picker => ({
  query: "",
  result: null,
  selected: null,
  busy: false,
});
const base = "/admin/product-alternatives";
type State = {
  accountId: number | null;
  denied: boolean;
  busy: boolean;
  saving: boolean;
  error: string;
  notice: string;
  conflict: boolean;
  first: Picker;
  second: Picker;
  context: BrandAlternativeReviewContext | null;
  evidence: string;
  sameUse: boolean;
  composition: boolean;
  initialise: () => Promise<void>;
  dispose: () => void;
  setQuery: (slot: Slot, query: string) => void;
  search: (slot: Slot) => Promise<void>;
  select: (slot: Slot, product: AdminAlternativeProductSearchItem) => void;
  load: () => Promise<void>;
  setEvidence: (value: string) => void;
  setConfirmation: (name: "sameUse" | "composition", value: boolean) => void;
  save: (approved: boolean) => Promise<void>;
};
export function createAdminProductAlternativesStore() {
  let epoch = 0;
  let selection = 0;
  const versions = { first: 0, second: 0 };
  const controllers: Partial<
    Record<Slot | "review" | "init", AbortController>
  > = {};
  const abortAll = () => Object.values(controllers).forEach((c) => c?.abort());
  return createStore<State>((set, get) => {
    const clearReview = () => {
      selection++;
      controllers.review?.abort();
      set({
        context: null,
        evidence: "",
        sameUse: false,
        composition: false,
        conflict: false,
        error: "",
        notice: "",
        busy: false,
      });
    };
    const fail = (error: unknown) => {
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        epoch++;
        abortAll();
        set({
          denied: true,
          accountId: null,
          first: picker(),
          second: picker(),
          context: null,
          evidence: "",
          sameUse: false,
          composition: false,
          conflict: false,
          busy: false,
          saving: false,
          notice: "",
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
    const pairPath = () =>
      `${base}/${get().first.selected!.product.id}/${get().second.selected!.product.id}`;
    return {
      accountId: null,
      denied: false,
      busy: false,
      saving: false,
      error: "",
      notice: "",
      conflict: false,
      first: picker(),
      second: picker(),
      context: null,
      evidence: "",
      sameUse: false,
      composition: false,
      dispose: () => {
        epoch++;
        selection++;
        abortAll();
        set({
          accountId: null,
          first: picker(),
          second: picker(),
          context: null,
          evidence: "",
          sameUse: false,
          composition: false,
          busy: false,
          saving: false,
          notice: "",
          error: "",
          conflict: false,
          denied: false,
        });
      },
      initialise: async () => {
        get().dispose();
        const version = epoch;
        const controller = (controllers.init = new AbortController());
        set({ busy: true });
        try {
          const session = await api<Session>("/auth/me", {
            signal: controller.signal,
          });
          if (version !== epoch) return;
          // Empty search checks administrator access and returns no catalogue records.
          await api<AdminAlternativeProductSearchResult>(
            `${base}/products?search=`,
            { signal: controller.signal },
          );
          if (version === epoch) set({ accountId: session.account.id });
        } catch (error) {
          if (version === epoch) fail(error);
        } finally {
          if (version === epoch) set({ busy: false });
        }
      },
      setQuery: (slot, query) => {
        if (get().saving) return;
        versions[slot]++;
        controllers[slot]?.abort();
        clearReview();
        set({ [slot]: { query, selected: null, result: null, busy: false } });
      },
      search: async (slot) => {
        if (!get().accountId || get().saving) return;
        controllers[slot]?.abort();
        const controller = (controllers[slot] = new AbortController());
        const version = ++versions[slot],
          session = epoch;
        const query = get()[slot].query.trim();
        set({
          [slot]: { ...get()[slot], busy: true, result: null },
          error: "",
        });
        try {
          const result = await api<AdminAlternativeProductSearchResult>(
            `${base}/products?search=${encodeURIComponent(query)}`,
            { signal: controller.signal },
          );
          if (version === versions[slot] && session === epoch)
            set({ [slot]: { ...get()[slot], result } });
        } catch (error) {
          if (version === versions[slot] && session === epoch) fail(error);
        } finally {
          if (version === versions[slot] && session === epoch)
            set({ [slot]: { ...get()[slot], busy: false } });
        }
      },
      select: (slot, product) => {
        if (get().saving || !get().accountId) return;
        if (
          get()[slot === "first" ? "second" : "first"].selected?.product.id ===
          product.product.id
        ) {
          set({ error: "Choose two different products." });
          return;
        }
        clearReview();
        set({ [slot]: { ...get()[slot], selected: product, result: null } });
      },
      load: async () => {
        if (
          !get().first.selected ||
          !get().second.selected ||
          get().saving ||
          !get().accountId
        )
          return;
        clearReview();
        const currentSelection = selection,
          session = epoch;
        const controller = (controllers.review = new AbortController());
        set({ busy: true });
        try {
          const context = await api<BrandAlternativeReviewContext>(pairPath(), {
            signal: controller.signal,
          });
          if (currentSelection === selection && session === epoch)
            set({ context });
        } catch (error) {
          if (currentSelection === selection && session === epoch) fail(error);
        } finally {
          if (currentSelection === selection && session === epoch)
            set({ busy: false });
        }
      },
      setEvidence: (evidence) => {
        if (!get().saving && !get().conflict) set({ evidence, notice: "" });
      },
      setConfirmation: (name, value) => {
        if (!get().saving && !get().conflict)
          set({ [name]: value, notice: "" });
      },
      save: async (approved) => {
        const state = get(),
          context = state.context;
        if (
          !context ||
          !state.accountId ||
          state.saving ||
          state.busy ||
          state.conflict ||
          !state.evidence.trim() ||
          state.evidence.length > 2000 ||
          (approved && (!state.sameUse || !state.composition)) ||
          (!approved && !context.reviews[0]?.approved)
        )
          return;
        const session = epoch,
          currentSelection = selection;
        const controller = (controllers.review = new AbortController());
        const path = pairPath();
        const request: BrandAlternativeReviewRequest = {
          approved,
          evidence: state.evidence.trim(),
          expectedReviewId: context.reviews[0]?.id ?? 0,
          sameUseAndFormatConfirmed: state.sameUse,
          dietaryAndCompositionChecked: state.composition,
          expectedProductFingerprint: context.product.fingerprint,
          expectedAlternativeFingerprint:
            context.alternativeProduct.fingerprint,
        };
        set({ saving: true, error: "", notice: "" });
        try {
          const identity = await api<Session>("/auth/me", {
            signal: controller.signal,
          });
          if (session !== epoch || currentSelection !== selection) return;
          if (identity.account.id !== state.accountId) {
            await get().initialise();
            set({
              error:
                "Your account changed. Select and review the products again before saving.",
            });
            return;
          }
          await api<BrandAlternativeReviewResponse>(path, {
            method: "PUT",
            body: JSON.stringify(request),
            signal: controller.signal,
          });
          if (session !== epoch || currentSelection !== selection) return;
          set({
            context: null,
            evidence: "",
            sameUse: false,
            composition: false,
            notice: approved
              ? "Approval saved. Eligible customers can now see this alternative."
              : "Withdrawal saved. This pair is no longer offered as an alternative.",
          });
          const refreshed = await api<BrandAlternativeReviewContext>(path, {
            signal: controller.signal,
          });
          if (session === epoch && currentSelection === selection)
            set({ context: refreshed });
        } catch (error) {
          if (session === epoch && currentSelection === selection) {
            fail(error);
            if (error instanceof ApiError && error.status === 409)
              set({
                conflict: true,
                context: null,
                sameUse: false,
                composition: false,
              });
          }
        } finally {
          if (session === epoch && currentSelection === selection)
            set({ saving: false });
        }
      },
    };
  });
}
