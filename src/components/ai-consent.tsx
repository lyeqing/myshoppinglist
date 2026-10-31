"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AccountForm from "@/components/account-form";
import { api, ApiError } from "@/lib/api-client";
import type { Session } from "@/lib/api-types";

type Preview = { accountId: string; clientName: string; scopes: string[]; offlineAccess: boolean };
export const scopeLabels: Record<string, string> = { "lists.read": "Read your shopping lists, items and saved prices", "products.read": "Read and search your saved products", "lists.write": "Create and edit your shopping lists", "extension.capture": "Request product captures and small retailer searches from your extension, with your approval" };

export default function AiConsent({ requestUri, clientId }: { requestUri: string; clientId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  const load = useCallback((signal?: AbortSignal) => {
    return api<Session>("/auth/me", { signal }).then(async current => {
      setSession(current); setLogin(false);
      if (current.account.isTrial) { setError("Sign in with a registered account to connect an AI app."); return; }
      if (!requestUri || requestUri.length > 2048 || !clientId || clientId.length > 100) throw new Error("Start a new connection from your AI app.");
      const result = await api<Preview>("/ai/oauth/preview", { method: "POST", body: JSON.stringify({ request_uri: requestUri, client_id: clientId }), signal });
      if (result.accountId !== String(current.account.id)) throw new Error("Your account changed. Review the connection again.");
      setPreview(result); setSelected(result.scopes); setOffline(result.offlineAccess);
    }).catch(e => {
      if (signal?.aborted) return;
      if (e instanceof ApiError && e.status === 401) { setSession(null); setLogin(true); }
      else setError(e instanceof Error ? e.message : "Unable to review this connection.");
    }).finally(() => { if (!signal?.aborted) setBusy(false); });
  }, [requestUri, clientId]);
  function refresh() { setBusy(true); setError(""); setPreview(null); void load(); }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  async function decide(approve: boolean) {
    if (!preview || busy) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ redirectUrl: string }>("/ai/oauth/authorize", { method: "POST", body: JSON.stringify({
        request_uri: requestUri, client_id: clientId, expected_account_id: preview.accountId,
        decision: approve ? "approve" : "deny", approved_scopes: [...selected, ...(offline ? ["offline_access"] : [])].join(" "),
      }) });
      window.location.assign(result.redirectUrl);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete this connection."); setPreview(null); setBusy(false); }
  }
  return <main className="mx-auto max-w-2xl px-5 py-10">
    <Link href="/" className="font-semibold text-primary-700">MyShoppingList</Link>
    <h1 className="mt-8 text-3xl font-semibold">Connect an AI app</h1>
    <p className="mt-3 text-slate-600">Only approve an app you recognise. It can access the permissions you choose below.</p>
    {busy && <p role="status" className="mt-6">Please wait…</p>}
    {error && <div role="alert" className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-900">{error}</div>}
    {login && <div className="mt-6"><AccountForm mode="login" trial={!!session?.account.isTrial} onBusy={setBusy} onClose={() => router.push("/")} onSuccess={refresh} /></div>}
    {session?.account.isTrial && <button className="mt-4 font-semibold underline" onClick={() => setLogin(true)}>Sign in to a registered account</button>}
    {preview && session && <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-semibold">{preview.clientName} wants to connect</h2>
      <p className="mt-2 text-sm text-slate-600">You are signed in as <strong>{session.account.displayName}</strong>. Access applies only to this account.</p>
      <fieldset disabled={busy} className="mt-5 space-y-4"><legend className="font-semibold">Allow this app to:</legend>
        {preview.scopes.map(scope => <label key={scope} className="flex items-start gap-3"><input type="checkbox" checked={selected.includes(scope)} onChange={e => setSelected(value => e.target.checked ? [...value, scope] : value.filter(s => s !== scope))} className="mt-1 size-5" /><span>{scopeLabels[scope] ?? scope}</span></label>)}
        {preview.offlineAccess && <label className="flex items-start gap-3"><input type="checkbox" checked={offline} onChange={e => setOffline(e.target.checked)} className="mt-1 size-5" /><span>Stay connected until you revoke access or the connection expires</span></label>}
      </fieldset>
      <p className="mt-5 text-sm text-slate-600">List names, notes and saved product details may be shared with this app. You can stop future access in <Link href="/ai/connections" className="underline">Connected AI apps</Link>. Data already received is subject to the app’s privacy policy.</p>
      <div className="mt-6 flex flex-wrap gap-3"><button disabled={busy || selected.length === 0} onClick={() => void decide(true)} className="rounded-xl bg-primary-700 px-5 py-3 font-semibold text-white disabled:opacity-50">Allow selected permissions</button><button disabled={busy} onClick={() => void decide(false)} className="rounded-xl border border-slate-300 px-5 py-3 font-semibold">Cancel connection</button></div>
    </section>}
    {!busy && !preview && !login && <button onClick={refresh} className="mt-5 font-semibold underline">Review request again</button>}
  </main>;
}
