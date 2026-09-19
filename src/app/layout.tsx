import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "MyShoppingList — Know before you shop", description: "Build your shopping list from product links and keep observed prices in one place." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
