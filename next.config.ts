import type { NextConfig } from "next";
const config: NextConfig = { allowedDevOrigins: ["127.0.0.1"], distDir: process.env.MYSHOPPINGLIST_NEXT_DIST_DIR ?? ".next" };
export default config;
