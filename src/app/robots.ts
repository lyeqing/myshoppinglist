import type { MetadataRoute } from "next";
import { privatePrefixes, publicOrigin } from "@/lib/seo";
export default function robots(): MetadataRoute.Robots {
  const origin = publicOrigin();
  // Owner decision: all crawlers may read public pages. Authentication and
  // noindex remain independent safeguards for private data.
  return origin ? { rules: { userAgent: "*", allow: "/", disallow: privatePrefixes }, sitemap: origin + "/sitemap.xml" }
    : { rules: { userAgent: "*", disallow: "/" } };
}
