# MyShoppingList frontend

Next.js 16.3.1, React 19.2.8, TypeScript, and Tailwind CSS 4. Stage 5A provides the first trial shopping page: start a three-hour trial, submit Coles product links, view import progress and observed prices, restore imports after refresh, and sign out.

## Run locally

Use Node.js 22 LTS and the MyShoppingList API at `http://localhost:5392`.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3001`. Start the backend separately from `D:/pra/myshoppinglist-api` using `dotnet run --launch-profile http`. It requires the migrated `MyShoppingList` PostgreSQL database and local connection configuration.

Optional environment settings (copy `.env.example` to `.env.local`):

- `MYSHOPPINGLIST_API_URL`: fixed backend origin, default `http://localhost:5392`.
- `MYSHOPPINGLIST_PUBLIC_ORIGIN`: exact browser-facing origin. Set explicitly behind a reverse proxy. Locally the request origin is used when unset. Match the hostname you open (`localhost` and `127.0.0.1` are distinct origins).
- `MYSHOPPINGLIST_NEXT_DIST_DIR`: isolated build output, primarily for tests.

The lockfile uses the dependency versions already locked in HandyTool. No credentials belong in environment examples or source control.

## Behaviour and gateway

The browser calls same-origin `/api/*` URLs. The gateway allows trial creation, session lookup, logout, product submission, individual status, and paginated discovery. It forwards only the MyShoppingList session cookie, never unrelated cookies or arbitrary upstream URLs. Raw credentials stay HttpOnly and are not stored in JavaScript or local storage.

POST requests require the custom request header and pass browser-origin/fetch-site checks before forwarding. JSON requests are limited to 4 KiB. Redirects are not followed, upstream requests time out after 15 seconds, and responses are not cached. Cookie Secure attributes are retained; HTTPS public deployments receive Secure cookies. Use HTTPS for the public application and production backend. The gateway does not bypass backend HTTPS redirects or certificate validation. Configure an API origin without credentials or a path.

Client-supplied forwarding headers are not trusted or forwarded. The backend trial-start rate limit therefore counts requests from the gateway's address together. Before a multi-user production deployment, configure trusted proxy/client-address handling deliberately. Import submission is separately limited per authenticated account.

Imports load in pages of 20, newest first. “Load older imports” fetches the next cursor page. Loaded active imports poll every two seconds without overlapping the previous round. Polling stops on terminal status, session expiry, navigation/unmount, or refresh failure. A failed refresh preserves the card and offers an explicit retry. Trial expiry clears private cards and offers a new trial; expiry is never silently extended.

The form is disabled during the short submission request to prevent a response clearing newly entered text. Other imports continue in parallel. Duplicate active submissions reuse the backend job; importing an existing product does not change its list quantity. Cards represent import history, so repeated imports may refer to the same list item. Displayed quantities are requested import quantities.

Prices show currency, scope, store context, and observation time. Unknown scope is labelled “Store not verified.” The UI makes no best-price or savings claim. Unavailable/unsupported/failed checks are distinct from “No match found.” Comparison providers, registered login, and list-item editing remain future stages.

## Verification

```powershell
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

Or use installed Chrome:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
Remove-Item Env:PLAYWRIGHT_CHANNEL
```

Playwright runs an isolated frontend on `127.0.0.1:3002` and a fake upstream on `127.0.0.1:5499`. Tests exercise the real gateway and UI without database or retailer requests. Coverage includes desktop/mobile layouts, HttpOnly sessions, submission/completion, refresh recovery, pagination, concurrent imports, expiry, validation, rate-limit feedback, polling retries, navigation cancellation, and gateway rejection. Screenshots and failure traces are saved in ignored output directories.

`next dev` may generate `AGENTS.md` and `CLAUDE.md` with standard Next.js documentation guidance. `next-env.d.ts` and TypeScript build information are generated too.
