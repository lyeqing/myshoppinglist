import AccountRecovery from "@/components/account-recovery";
import { privateMetadata } from "@/lib/seo";
export const metadata = { ...privateMetadata, title: "Recover your account" };
export default function Page() { return <AccountRecovery />; }
