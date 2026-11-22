# MyShoppingList frontend

ALDI product importing is available through the Add to list extension (version 0.5.0): open an ALDI product, choose a shopping list and quantity, then click Add. Reload the extension after updating to enable ALDI host permissions, and run the updated API. ALDI website-only URL imports return instructions to use the extension. Automatic ALDI searches and price refreshes are unavailable; prices are observed page prices with unverified store scope. Imported ALDI products use the normal product cards, History, Favorites and Essentials.

Next.js 16.3.1, React 19.2.8, TypeScript, and Tailwind CSS 4. Stage 5A provides the first trial shopping page: start a three-hour trial, submit Coles or Woolworths product links, view import progress and observed prices, restore imports after refresh, and sign out.

## Run locally

Use Node.js 22 LTS and the MyShoppingList API at `http://localhost:5392`.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3001`. Start the backend separately from `D:/pra/myshoppinglist-api` using `dotnet run --launch-profile http`. It requires the migrated `MyShoppingList` PostgreSQL database and local connection configuration.

Optional environment settings (copy `.env.example` to `.env.local`):

- `MYSHOPPINGLIST_INTERNAL_API_URL`: preferred server-only backend origin, for example `http://127.0.0.1:5392`. Empty/unset uses `MYSHOPPINGLIST_API_URL` instead. An invalid configured origin fails closed; a failed internal request is never retried through the public URL.
- `MYSHOPPINGLIST_API_URL`: existing server-side fallback backend origin, default `http://localhost:5392`. It may remain a public HTTPS origin when the internal origin is configured. It is not exposed to browser JavaScript.
- `MYSHOPPINGLIST_PUBLIC_ORIGIN`: exact browser-facing origin. Set explicitly behind a reverse proxy. Locally the request origin is used when unset. Match the hostname you open (`localhost` and `127.0.0.1` are distinct origins).
- `MYSHOPPINGLIST_NEXT_DIST_DIR`: isolated build output, primarily for tests.

The lockfile uses the dependency versions already locked in HandyTool. No credentials belong in environment examples or source control.

## Internal API transport and deployment

Browser JavaScript continues to call the website's same-origin `/api/*` gateway. The gateway and server-rendered administrator access checks use the shared `server-only` origin resolver in `src/lib/server-api-origin.ts`, connecting directly to the preferred internal API origin. Future Server Components, Server Actions and route handlers that call the backend should reuse this resolver; the interactive `api-client.ts` remains the browser client. This change adds no new proxy, browser configuration, dependency, API contract or database migration. Cookies, route allowlists, redirect handling, request limits, cancellation and uncached responses retain their existing behaviour. Never put the internal address in a `NEXT_PUBLIC_*` variable, client props or `next.config.ts` `env`.

- Local development: set `MYSHOPPINGLIST_INTERNAL_API_URL=http://127.0.0.1:5392` in ignored `.env.local` and restart Next.js. Keep ngrok's public HTTPS URL and the API's public AI issuer/resource configuration for external AI clients; normal website requests no longer need the tunnel. Keep `MYSHOPPINGLIST_PUBLIC_ORIGIN` equal to the actual website origin (user development port 3000; automated tests use 3001).
- Docker: use a private service address such as `http://api:8080`, with the API listening on that container interface. Loopback inside the Next.js container does not address the API container. Do not publish that HTTP port on the host's public interfaces.
- Production: supply the internal setting to the Next.js **runtime**, not only its build. Keep the website and independent public API behind HTTPS. On one VPS, use a loopback/private API listener; on separate hosts, use a private network and appropriate TLS. Restrict the backend listener with firewall/container networking, and expose approved public API, mobile authentication and AI/OAuth routes through the public HTTPS reverse proxy. Internal routing should connect straight to the backend or a private TLS listener, bypassing public DNS/Cloudflare. No VPS, firewall, certificate or reverse-proxy configuration is installed by this repository change.
- Important production prerequisite: the API currently redirects HTTP to HTTPS outside Development. Do not disable that protection or certificate validation. Use an internal HTTPS listener with a valid trusted certificate; using internal HTTP in Production requires a separately reviewed trusted ingress configuration. The existing development-only loopback forwarding option is not a production proxy setup. The gateway deliberately rejects unexpected upstream redirects, so test the selected address before deployment.
- Preserve the API's public issuer/resource, social website origin/callbacks and existing rate limits. Current gateway traffic shares the gateway's network IP for IP-based limits; trusted client-IP forwarding is a separate deployment decision. CORS remains unchanged because website requests stay same-origin. Native mobile clients can call the public API directly using the existing mobile registration/login endpoints and bearer tokens stored in platform-secure storage; they do not depend on Next.js. Native social-login/deep-link integration still needs its own design and provider verification.

Routing verification: `node --test tests/server-api-origin.test.mjs tests/api-client-security.test.mjs` checks internal preference, Docker names, fallback, invalid configuration and no retry after a failed write. `playwright.api-routing.config.ts` runs the actual gateway and SSR access check against separate internal/public HTTP fixtures, preserving HttpOnly login/reload/logout, cookie filtering, screenshot downloads, rate-limit feedback and social redirect checks. For its production mode, build with `MYSHOPPINGLIST_NEXT_DIST_DIR=.next-api-routing` and run `node node_modules/@playwright/test/cli.js test --config playwright.api-routing.config.ts`. Set `MYSHOPPINGLIST_ROUTING_TEST_MODE=development` to exercise the routing fixture with the development server. All fixtures use loopback ports, never live providers or the application database. Existing Playwright configurations explicitly leave the internal override empty so `.env.local` cannot redirect their fixture traffic.

## Behaviour and gateway

The browser calls same-origin `/api/*` URLs. The gateway allows trial creation, registration, login, session lookup, logout, explicit expired-session reset, product submission, individual status, paginated discovery, list-item reads and item edits. It forwards only the MyShoppingList session cookie, never unrelated cookies or arbitrary upstream URLs. Session tokens stay HttpOnly. Passwords are held only in the form while needed, sent to the authentication endpoint and never stored in local storage.

POST and PUT requests require the custom request header and pass browser-origin/fetch-site checks before forwarding. Request bodies are limited to 4 KiB, except registration/login allow 16 KiB for Unicode credentials and item-edit PUT requests allow 32 KiB for up to 4,000-character notes including JSON escapes and UTF-8 text. Registration/login require JSON objects. Redirects are not followed, upstream requests time out after 15 seconds, and responses are not cached. Cookie Secure attributes are retained; HTTPS public deployments receive Secure cookies. Use HTTPS for the public application and production backend. The gateway does not bypass backend HTTPS redirects or certificate validation. Configure an API origin without credentials or a path.

Client-supplied forwarding headers are not trusted or forwarded. The backend trial-start, registration and login IP limits therefore count requests from the gateway's address together. Before a multi-user production deployment, configure trusted proxy/client-address handling deliberately. Import submission is separately limited per authenticated account.

Imports load in pages of 20, newest first. “Load older imports” fetches the next cursor page. Loaded active imports poll every two seconds without overlapping the previous round. Polling stops on terminal status, session expiry, navigation/unmount, or refresh failure. A failed refresh preserves the card and offers an explicit retry. Trial expiry clears private cards and offers a new trial; expiry is never silently extended.

The form is disabled during the short submission request to prevent a response clearing newly entered text. Other imports continue in parallel. Duplicate active submissions reuse the backend job; importing an existing product does not change its list quantity. The editable shopping list shows actual items. Separate import-history cards may refer to the same item and display the original requested import quantities.

Prices show currency, scope, store context, and observation time. Unknown scope is labelled “Store not verified.” Stage 6C adds conditional best-known price summaries as described below. Unavailable/unsupported/failed checks are distinct from “No match found.” Registered login is available through Stage 8B.

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

Playwright runs an isolated frontend on `127.0.0.1:3001` and a fake upstream on `127.0.0.1:5499`. Tests exercise the real gateway and UI without database or retailer requests. Coverage includes desktop/mobile layouts, HttpOnly sessions, submission/completion, refresh recovery, pagination, concurrent imports, expiry, validation, rate-limit feedback, polling retries, navigation cancellation, and gateway rejection. Screenshots and failure traces are saved in ignored output directories. The separate `playwright.research.config.ts` runs the real research journey against an explicitly disposable API/database; see the backend research runbook before enabling it.

`next dev` may generate `AGENTS.md` and `CLAUDE.md` with standard Next.js documentation guidance. `next-env.d.ts` and TypeScript build information are generated too.

## Stage 5B – Woolworths source imports

The product URL field accepts current Coles and Woolworths product-page links. Both use the same background progress, polling, refresh recovery, and source-price display. Woolworths links should be copied from the current retailer page; outdated slugs may return not found. Backend Stage 6B now runs cross-retailer comparisons. Browser tests cover Woolworths submission and source-link recovery on desktop and mobile.

## Stage 6C – Comparison display

Product cards show match status, saved-observation context and freshness separately. Central constants in `src/lib/price-comparison.ts` label prices up to 6 hours old as Fresh, over 6 through 24 hours as Refresh recommended, and over 24 hours as Price may be stale. Invalid or future timestamps are unverified. Labels and recommendations update every minute and on window focus after terminal polling stops, without fetching retailers or extending the trial. These display thresholds are independent of the backend's configurable cache reuse threshold.

Best-known prices require fresh exact matches from at least two distinct retailers. Each currency and scope is compared separately: only location-free National offers compare with National, and Online with Online. Unknown/store-specific/other scopes remain visible but receive no recommendation. Ties name all winning retailers. Summaries describe the price per product pack and count only eligible retailers; they do not claim the cheapest price everywhere or a verified local-store price. Availability and final price still require confirmation with the retailer.

Out-of-stock, uncertain matches, invalid amounts/times, expired or future promotions, malformed promotion dates, and identified membership/multibuy offers are excluded. Stock availability that was not reported is not treated as confirmed stock. Warnings preserve observed prices rather than substituting a normal price or hiding old observations. Likely/Possible matches explain that identity needs confirmation, unavailable checks preserve the source product, and bounded search misses describe only the candidates checked.

There are no basket totals or savings calculations: import history may contain repeated references to the same shopping-list item. Stage 6A live access limitations remain: Woolworths denied isolated browser access and Coles timed out in previous checks. UI tests use a fake upstream, so passing them does not verify live retailer access.

Comparison tests cover desktop/mobile rendering, cache labels, ties, scope/currency separation, freshness boundaries, stale/invalid/future dates, uncertain and unavailable results, promotion exclusions, and recommendations expiring after polling stops.

## Stage 7B – Editable shopping list

The shopping list now loads actual items from the Stage 7A API above the separate import history and price comparisons. Each product has one editor even after repeated imports. Edit a positive whole-number quantity, notes (up to 4,000 characters), Purchased and Hidden, then choose Save changes. Empty notes clear the saved notes. Purchase dates are managed by the backend. Hiding preserves the item; select Show hidden, clear Hidden and save to restore it.

Show purchased and Show hidden filter the loaded items locally. Pages contain 20 items including hidden/purchased records, and the count explicitly refers to loaded items. Load more items continues the cursor when more records are available. Hidden editors remain mounted so switching filters does not discard drafts. Refresh items reloads the loaded range; import persistence/completion also triggers an item refresh without continuously polling terminal items. Price observations remain in import history.

Drafts survive failed saves and background refreshes in the current page. Saved updates retain the backend UTC timestamp verbatim for optimistic concurrency. A conflict or newer saved version blocks further saves until Load latest saved version is chosen; the UI explains that this explicit action replaces unsaved edits. Failed reloads preserve the draft. Successful edits invalidate older in-flight list reads. Session expiry/sign-out clears editors and aborts their requests. Unsaved drafts are not persisted across browser reload/navigation, sign-out or expiry.

The gateway allows GET `/api/shopping-lists/{id}/items` and PUT `/api/shopping-lists/{id}/items/{itemId}` only, with numeric pagination and validated boolean filters. PUT cannot invoke the trial/import routes, and POST cannot edit items. Browser protection, cookie isolation, JSON content-type checks and response no-store policy remain in force. No backend or database changes are part of Stage 7B.

Desktop/mobile tests cover edit persistence, clearing notes, purchased/hidden filters and restoration, repeated imports, pagination, preserving drafts on refresh/errors/conflicts, explicit conflict reload, session expiry, full-length Unicode notes, and gateway method/route/filter/body-size protections. Tests use a fake API rather than live retailer requests.

## Stage 8B – Registration and login

Choose Create an account or Sign in from the welcome page. An active trial offers Keep my list, which registers the same account and retains its list, saved edits and current editor drafts. Registration asks for a display name, email and a password of at least 8 characters with a digit (0–9), a lowercase letter (a–z), an uppercase letter (A–Z), and a punctuation or symbol character such as !, @ or # (the backend remains authoritative). Spaces do not count as special characters. Existing passwords remain valid for login. Forms provide password-manager autocomplete, labelled inputs, pending states and validation/error feedback. Failed submissions retain entered values for correction; cancelling, changing form mode or successful authentication removes the form and password from its state.

Signing in from a trial explicitly explains that its list is not merged into the existing account and unsaved edits will be discarded. Switching accounts clears old list/import state; generation checks discard stale import responses. Conversion preserves mounted list editors. Import polling pauses during account requests and resumes afterward. Registered sessions restore on reload, display the account name, and use account-appropriate expiry/sign-out messages. Long sessions recheck the remaining time after each browser timer limit instead of expiring early.

If registration encounters an expired session, it offers Clear expired session for a new account. This explicit action calls the gateway-only POST `/api/auth/reset-expired`, which requires browser request protection and checks the current session with the backend. Only a 401 permits cookie deletion; a valid session returns 409 and upstream failures leave the cookie untouched. The user then submits again to create a new, empty list. Expired trial data cannot be recovered, and reset does not register an account automatically.

This stage requires the Stage 8A API and changes no backend files or database schema. Email verification, password reset and account recovery remain unimplemented. Browser tests use a fake upstream; they exercise the real gateway and interface but do not replace the backend's database tests or establish live retailer access.

Stage 8B verification: all 44 desktop/mobile browser tests passed using installed Chrome, ESLint passed, and the production build passed. Registration and converted-list screenshots were inspected at both viewport sizes. The Windows test server required explicit process cleanup after the tests completed; the runner then exited successfully.
