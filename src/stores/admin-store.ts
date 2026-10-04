import { create } from "zustand";
import { api } from "@/lib/api-client";

export type AdminAccount = { id: number; email: string | null; displayName: string; isPaid: boolean; isActive: boolean;
  contributionBlocked: boolean; contributionEnabled: boolean; restrictionReason: string | null; updatedDate: string };
export type Review = { observations: { id: number; source: string; url: string; outcome: string; receivedAt: string; extensionVersion: string }[];
  actions: { id: number; administratorId: number; reason: string; beforeJson: string; afterJson: string; createdAt: string }[] };
type State = { accounts: AdminAccount[]; review: Review | null; selected: number | null; busy: boolean; error: string;
  load: (search?: string) => Promise<void>; inspect: (id: number) => Promise<void>;
  save: (account: AdminAccount, reason: string) => Promise<void> };
export const useAdminStore = create<State>((set, get) => ({
  accounts: [], review: null, selected: null, busy: false, error: "",
  load: async (search = "") => {
    set({ busy: true, error: "", review: null, selected: null });
    try { set({ accounts: await api<AdminAccount[]>(`/admin/accounts?search=${encodeURIComponent(search)}`) }); }
    catch (e) { set({ accounts: [], error: e instanceof Error ? e.message : "Unable to load accounts." }); }
    finally { set({ busy: false }); }
  },
  inspect: async id => {
    set({ busy: true, error: "", selected: id, review: null });
    try { set({ review: await api<Review>(`/admin/accounts/${id}/review`) }); }
    catch (e) { set({ error: e instanceof Error ? e.message : "Unable to load review." }); }
    finally { set({ busy: false }); }
  },
  save: async (account, reason) => {
    set({ busy: true, error: "" });
    try {
      await api(`/admin/accounts/${account.id}`, { method: "PUT", body: JSON.stringify({ isPaid: account.isPaid,
        contributionBlocked: account.contributionBlocked, isActive: account.isActive, reason, expectedUpdatedDate: account.updatedDate }) });
      await get().load(account.email ?? "");
    } catch (e) { set({ error: e instanceof Error ? e.message : "Unable to update account." }); }
    finally { set({ busy: false }); }
  },
}));
