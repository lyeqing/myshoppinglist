import { publicMetadata } from "@/lib/seo";
import Link from "next/link";
import FeedbackForm from "@/components/feedback-form";
export const metadata = publicMetadata("Support · MyShoppingList", "Get help saving products, managing private lists and requesting account export or deletion.", "/support");
export default function Page() { return <main className="mx-auto max-w-3xl px-5 py-8"><Link href="/" className="font-semibold text-primary-700 underline">MyShoppingList</Link><h1 className="mt-6 text-3xl font-semibold">Help and feedback</h1><p className="mt-3 text-slate-600">To save a product, open its supported retailer page, choose Read product in the extension, review the details and save to your list. Saved observations can become outdated; verify price and availability with the retailer before shopping.</p><FeedbackForm /></main>; }
