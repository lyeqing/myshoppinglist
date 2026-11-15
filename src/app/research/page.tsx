import type { Metadata } from "next";
import ResearchWorkspace from "@/components/research-workspace";

export const metadata: Metadata = {
  title: "Research products",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  return <ResearchWorkspace />;
}
