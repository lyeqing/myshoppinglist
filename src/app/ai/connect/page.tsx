import type { Metadata } from "next";
import AiConsent from "@/components/ai-consent";

export const metadata: Metadata = { title: "Connect an AI app", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <AiConsent requestUri={typeof params.request_uri === "string" ? params.request_uri : ""} clientId={typeof params.client_id === "string" ? params.client_id : ""} />;
}
