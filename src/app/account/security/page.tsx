import AccountSecurity from "@/components/account-security";
import { privateMetadata } from "@/lib/seo";
export const metadata = { ...privateMetadata, title: "Password and account security" };
export default function Page() { return <AccountSecurity />; }
