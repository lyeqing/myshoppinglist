import "server-only";
import { cookies } from "next/headers";
import { serverApiOrigin } from "./server-api-origin";
export async function hasAdministratorSession(): Promise<boolean> {
  const session = (await cookies()).get("myshoppinglist_session")?.value;
  if (!session || !/^[a-f0-9]{64}$/.test(session)) return false;
  try {
    const upstream = serverApiOrigin();
    const response = await fetch(new URL("/api/admin/session", upstream), { headers: { Cookie: `myshoppinglist_session=${session}` },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    return response.ok;
  } catch { return false; }
}
