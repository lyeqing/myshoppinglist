import "server-only";

// Resolve at request time. A failed internal request must never be retried publicly.
export function serverApiOrigin(): URL {
  const internal = process.env.MYSHOPPINGLIST_INTERNAL_API_URL?.trim();
  const origin = new URL(internal || process.env.MYSHOPPINGLIST_API_URL || "http://localhost:5392");
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password
    || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Configure an HTTP(S) API origin without credentials, a path, query or fragment.");
  }
  return origin;
}
