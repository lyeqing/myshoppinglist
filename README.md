# MyShoppingList frontend

Next.js 16.3.1, React 19.2.8, TypeScript, and Tailwind CSS 4. Stage 5A provides the first trial shopping page: start a three-hour trial, submit Coles or Woolworths product links, view import progress and observed prices, restore imports after refresh, and sign out.

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

Prices show currency, scope, store context, and observation time. Unknown scope is labelled “Store not verified.” Stage 6C adds conditional best-known price summaries as described below. Unavailable/unsupported/failed checks are distinct from “No match found.” Registered login and list-item editing remain future stages.

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

## Stage 5B – Woolworths source imports

The product URL field accepts current Coles and Woolworths product-page links. Both use the same background progress, polling, refresh recovery, and source-price display. Woolworths links should be copied from the current retailer page; outdated slugs may return not found. Backend Stage 6B now runs cross-retailer comparisons. Browser tests cover Woolworths submission and source-link recovery on desktop and mobile.

## Stage 6C – Comparison display

Product cards show match status, saved-observation context and freshness separately. Central constants in `src/lib/price-comparison.ts` label prices up to 6 hours old as Fresh, over 6 through 24 hours as Refresh recommended, and over 24 hours as Price may be stale. Invalid or future timestamps are unverified. Labels and recommendations update every minute and on window focus after terminal polling stops, without fetching retailers or extending the trial. These display thresholds are independent of the backend's configurable cache reuse threshold.

Best-known prices require fresh exact matches from at least two distinct retailers. Each currency and scope is compared separately: only location-free National offers compare with National, and Online with Online. Unknown/store-specific/other scopes remain visible but receive no recommendation. Ties name all winning retailers. Summaries describe the price per product pack and count only eligible retailers; they do not claim the cheapest price everywhere or a verified local-store price. Availability and final price still require confirmation with the retailer.

Out-of-stock, uncertain matches, invalid amounts/times, expired or future promotions, malformed promotion dates, and identified membership/multibuy offers are excluded. Stock availability that was not reported is not treated as confirmed stock. Warnings preserve observed prices rather than substituting a normal price or hiding old observations. Likely/Possible matches explain that identity needs confirmation, unavailable checks preserve the source product, and bounded search misses describe only the candidates checked.

There are no basket totals or savings calculations: import history may contain repeated references to the same shopping-list item. Stage 6A live access limitations remain: Woolworths denied isolated browser access and Coles timed out in previous checks. UI tests use a fake upstream, so passing them does not verify live retailer access.

Comparison tests cover desktop/mobile rendering, cache labels, ties, scope/currency separation, freshness boundaries, stale/invalid/future dates, uncertain and unavailable results, promotion exclusions, and recommendations expiring after polling stops.
