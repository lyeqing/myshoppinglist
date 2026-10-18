import type { Metadata } from "next";
import "./globals.css";
import ProductLibraryProvider from "@/components/product-library-provider";
export const metadata: Metadata = { title: "MyShoppingList — Know before you shop", description: "Build your shopping list from product links and keep observed prices in one place." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><ProductLibraryProvider>{children}</ProductLibraryProvider></body></html>;
}
