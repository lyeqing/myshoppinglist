import "server-only";
import { cookies } from "next/headers";
export async function hasAdministratorSession(): Promise<boolean> {
  const session = (await cookies()).get("myshoppinglist_session")?.value;
  if (!session || !/^[a-f0-9]{64}$/.test(session)) return false;
  try {
    const upstream = new URL(process.env.MYSHOPPINGLIST_API_URL ?? "http://localhost:5392");
    if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== "/") return false;
    const response = await fetch(new URL("/api/admin/session", upstream), { headers: { Cookie: `myshoppinglist_session=${session}` },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    return response.ok;
  } catch { return false; }
}
