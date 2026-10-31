import type { Metadata } from "next";
import AiConnections from "@/components/ai-connections";
export const metadata: Metadata = { title: "Connected AI apps", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function Page() { return <AiConnections />; }
