import type { NextConfig } from "next";
const config: NextConfig = { allowedDevOrigins: ["127.0.0.1"], distDir: process.env.MYSHOPPINGLIST_NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  async headers() { return [{ source: "/:path*", headers: [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ...(process.env.MYSHOPPINGLIST_PUBLIC_ORIGIN?.startsWith("https://")
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  ] }]; },
  experimental: { reactDebugChannel: false } };
export default config;
