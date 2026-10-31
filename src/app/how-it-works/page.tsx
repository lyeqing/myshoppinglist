import Link from "next/link";
import PublicPage from "@/components/public-page";
import { publicMetadata } from "@/lib/seo";
export const metadata = publicMetadata("How to save products and plan a shop · MyShoppingList", "Create a list, review supported product pages and keep private dated observations for your next shop.", "/how-it-works");
export default function Page() { return <PublicPage title="From a product page to your list" intro="A short review keeps your list useful and your saved observations honest."><ol className="list-decimal space-y-6 pl-6">
    <li><h2 className="text-xl font-semibold">Start your list</h2><p>Create an account or try the temporary three-hour list. Register before the trial expires if you want to keep it. An expired trial cannot be converted into a saved account.</p></li>
    <li><h2 className="text-xl font-semibold">Set up the Chrome test extension</h2><p>Public Web Store installation is not available yet. <Link href="/extension" className="text-primary-700 underline">See current setup options</Link> and ask the service owner about access.</p></li>
    <li><h2 className="text-xl font-semibold">Read one supported product</h2><p>Open a public Coles, Woolworths or ALDI product page. Choose your list and quantity in the extension, then click Read product. Restricted or unreadable pages are reported; the extension does not bypass them.</p></li>
    <li><h2 className="text-xl font-semibold">Review, then save</h2><p>Check the product identity, amount and any price conditions. Save the observation to your list, or cancel. The timestamp records your observation; it does not verify a store location or guarantee a current price.</p></li>
    <li><h2 className="text-xl font-semibold">Shop with context</h2><p>Adjust quantities and notes on desktop or mobile. Collect other retailer observations yourself when you want to compare them. Confirm current prices and stock with the retailer before buying.</p></li>
  </ol></PublicPage>; }
