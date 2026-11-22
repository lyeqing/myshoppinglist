import AccountSecurity from "@/components/account-security";
import { privateMetadata } from "@/lib/seo";
export const metadata = { ...privateMetadata, title: "Account settings" };
export default function Page() { return <AccountSecurity />; }
