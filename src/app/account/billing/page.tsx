import BillingPanel from "@/components/billing-panel";
import { privateMetadata } from "@/lib/seo";
export const metadata = { ...privateMetadata, title: "Billing" };
export default function Page() { return <BillingPanel />; }
