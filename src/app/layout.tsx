import type { Metadata } from "next";
import "./globals.css";
import ProductLibraryProvider from "@/components/product-library-provider";
import AnalyticsPreferences from "@/components/analytics-preferences";
import { Suspense } from "react";
import OperationalDiagnostics from "@/components/operational-diagnostics";
import SiteFooter from "@/components/site-footer";
import AuthAvailabilityBoundary from "@/components/auth-availability-boundary";
import { publicMetadata, publicOrigin } from "@/lib/seo";
import { headers } from "next/headers";
const origin = publicOrigin();
export const metadata: Metadata = { ...publicMetadata("MyShoppingList — Your private shopping list", "Keep private shopping lists and reviewed, dated product observations in one place. Saved prices are not live retailer checks.", "/"),
  metadataBase: new URL(origin || "http://localhost:3001"), ...(!origin ? { robots: { index: false, follow: false } } : {}) };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Nonces require request-time rendering, including the public pages.
  await headers();
  return <html lang="en"><body><AuthAvailabilityBoundary><ProductLibraryProvider>{children}</ProductLibraryProvider><SiteFooter /></AuthAvailabilityBoundary><OperationalDiagnostics /><Suspense><AnalyticsPreferences /></Suspense></body></html>;
}
