import type { MetadataRoute } from "next";
import { publicOrigin, publicPages } from "@/lib/seo";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = publicOrigin();
  return origin ? publicPages.map(path => ({ url: origin + path })) : [];
}
