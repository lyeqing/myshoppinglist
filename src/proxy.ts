import { NextRequest, NextResponse } from "next/server";

// Next.js reads the request CSP to attach this nonce to framework scripts.
// Always overwrite caller-supplied nonce/CSP headers.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${development ? " ws://localhost:3001 ws://127.0.0.1:3001" : ""}`,
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
    "frame-src 'none'", "form-action 'self'",
    ...(process.env.MYSHOPPINGLIST_PUBLIC_ORIGIN?.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  // A nonce must never be reused by a shared HTML cache.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|opengraph-image|icon.svg).*)"],
};
