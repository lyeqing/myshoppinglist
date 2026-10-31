import { create } from "zustand";
import { api } from "@/lib/api-client";

export type AdminAccount = { id: number; email: string | null; displayName: string; isPaid: boolean; isActive: boolean;
  contributionBlocked: boolean; contributionEnabled: boolean; restrictionReason: string | null; updatedDate: string;
  isTrial?: boolean; createdDate?: string; expiresDate?: string | null; lastSessionContact?: string | null; lastItemSave?: string | null };
export type Review = { observations: { id: number; source: string; url: string; outcome: string; receivedAt: string; extensionVersion: string }[];
  actions: { id: number; administratorId: number; reason: string; beforeJson: string; afterJson: string; createdAt: string }[] };
type State = { accounts: AdminAccount[]; review: Review | null; selected: number | null; busy: boolean; error: string;
  clear: () => void;
  load: (search?: string, state?: string) => Promise<void>; inspect: (id: number) => Promise<void>;
  save: (account: AdminAccount, reason: string) => Promise<void> };
let generation = 0;
export const useAdminStore = create<State>((set, get) => ({
  accounts: [], review: null, selected: null, busy: false, error: "",
  clear: () => { generation++; set({ accounts: [], review: null, selected: null, busy: false, error: "" }); },
  load: async (search = "", state = "") => {
    const current = ++generation;
    set({ accounts: [], busy: true, error: "", review: null, selected: null });
    try { const accounts = await api<AdminAccount[]>(`/admin/accounts?search=${encodeURIComponent(search)}${state ? `&state=${encodeURIComponent(state)}` : ""}`); if (current === generation) set({ accounts }); }
    catch (e) { if (current === generation) set({ accounts: [], error: e instanceof Error ? e.message : "Unable to load accounts." }); }
    finally { if (current === generation) set({ busy: false }); }
  },
  inspect: async id => {
    const current = ++generation;
    set({ busy: true, error: "", selected: id, review: null });
    try { const review = await api<Review>(`/admin/accounts/${id}/review`); if (current === generation) set({ review }); }
    catch (e) { if (current === generation) set({ error: e instanceof Error ? e.message : "Unable to load review." }); }
    finally { if (current === generation) set({ busy: false }); }
  },
  save: async (account, reason) => {
    const current = ++generation;
    set({ busy: true, error: "" });
    try {
      await api(`/admin/accounts/${account.id}`, { method: "PUT", body: JSON.stringify({ isPaid: account.isPaid,
        contributionBlocked: account.contributionBlocked, isActive: account.isActive, reason, expectedUpdatedDate: account.updatedDate }) });
      if (current === generation) await get().load(account.email ?? "");
    } catch (e) { if (current === generation) set({ error: e instanceof Error ? e.message : "Unable to update account." }); }
    finally { if (current === generation) set({ busy: false }); }
  },
}));
