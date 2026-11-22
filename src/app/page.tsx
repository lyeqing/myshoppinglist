import ShoppingListApp from "@/components/shopping-list-app";
import ShoppingStoreProvider from "@/components/shopping-store-provider";
import { publicOrigin } from "@/lib/seo";
import { headers } from "next/headers";
const application = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "MyShoppingList", applicationCategory: "ShoppingApplication",
  operatingSystem: "Web", description: "Private shopping lists and customer-reviewed, dated product observations. Saved prices are not live retailer checks.", ...(publicOrigin() ? { url: publicOrigin() } : {}) };
export default async function Page() { const nonce = (await headers()).get("x-nonce") ?? undefined; return <><script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(application).replace(/</g, "\\u003c") }} /><ShoppingStoreProvider><ShoppingListApp /></ShoppingStoreProvider></>; }
