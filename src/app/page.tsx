import ShoppingListApp from "@/components/shopping-list-app";
import ShoppingStoreProvider from "@/components/shopping-store-provider";
import { publicOrigin } from "@/lib/seo";
const application = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "MyShoppingList", applicationCategory: "ShoppingApplication",
  operatingSystem: "Web; Chrome extension for product capture", description: "Private shopping lists and customer-reviewed, dated product observations. Saved prices are not live retailer checks.", ...(publicOrigin() ? { url: publicOrigin() } : {}) };
export default function Page() { return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(application).replace(/</g, "\\u003c") }} /><ShoppingStoreProvider><ShoppingListApp /></ShoppingStoreProvider></>; }
