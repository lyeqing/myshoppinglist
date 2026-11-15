import type { Metadata } from "next";
export const publicPages = ["/", "/features", "/how-it-works", "/extension", "/faq", "/pricing", "/support", "/privacy"];
export const privatePrefixes = ["/api", "/account", "/admin", "/superadmin", "/ai", "/research", "/settings", "/favorites", "/essentials", "/history", "/products", "/in-store"];
export function publicOrigin(): string | null {
  const configured = process.env.MYSHOPPINGLIST_PUBLIC_ORIGIN;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
        || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}
export function publicMetadata(title: string, description: string, path: string): Metadata {
  const origin = publicOrigin();
  return { title, description, ...(origin ? { alternates: { canonical: origin + path } } : {}),
    openGraph: { title, description, type: "website", siteName: "MyShoppingList", ...(origin ? { url: origin + path } : {}) },
    twitter: { card: "summary_large_image", title, description } };
}
export const privateMetadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer", alternates: { canonical: null } };
