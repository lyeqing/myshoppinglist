import Link from "next/link";
import PublicPage from "@/components/public-page";
import { publicMetadata } from "@/lib/seo";
export const metadata = publicMetadata("How to research products and plan a shop · MyShoppingList", "Prepare an AI research request, review suggestions and choose products for your private list.", "/how-it-works");
export default function Page() { return <PublicPage title="From a shopping idea to your list" intro="Research with your AI app and stay in control of what gets saved."><ol className="list-decimal space-y-6 pl-6">
    <li><h2 className="text-xl font-semibold">Start your list</h2><p>Create a free account or sign in to start your shopping list. An account is required for all shopping and AI features. No payment details are needed.</p></li>
    <li><h2 className="text-xl font-semibold">Connect your AI app</h2><p>With a registered account, open Connected AI apps in Settings. Use your MCP address in a supported app, then approve its permissions. Availability depends on your app and service configuration.</p></li>
    <li><h2 className="text-xl font-semibold">Prepare and send your request</h2><p><Link href="/research" className="font-semibold text-primary-700 underline">Research products</Link> lets you describe what you need. Copy the prepared request into your connected AI app and send it. Opening the app does not start research.</p></li>
    <li><h2 className="text-xl font-semibold">Review and choose</h2><p>Return to Research products and refresh your research. Review suggestions and choose what to add. If your app cannot submit directly, import its structured response. AI-reported prices remain unverified and excluded from definitive totals.</p></li>
    <li><h2 className="text-xl font-semibold">Shop with context</h2><p>Adjust quantities and notes on desktop or mobile. Add an item without a price when needed. Confirm current prices and stock with the retailer before buying.</p></li>
  </ol></PublicPage>; }
