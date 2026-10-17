# MyShoppingList frontend and extensions handover

Updated 17 October 2026 (Australia/Adelaide). Also read [backend handover](../myshoppinglist-api/HANDOVER.md), which covers processing, database, business rules and detailed status. These files are continuation context, not permission to start new edits.

## User's working rules

Before changing any file, explain the intended outcome, exact file list and changes, why each is needed, and ordered steps; then wait for approval. Only change approved files. Ask about ambiguity. Explain actions before doing them and always format code. Preserve unrelated changes.

**Port 3000 belongs to the user. Codex uses 3001.** Never stop/restart the user's frontend. Ask if 3001 is occupied before stopping its process or choosing another port. Use a command-line override rather than changing defaults. Use **Zustand** for global state. No subagent work is currently requested.

Read `AGENTS.md` before coding. It requires reading relevant installed Next.js documentation in `node_modules/next/dist/docs/`, because this version's APIs may differ from remembered ones. `CLAUDE.md` references that file. Never document credentials or worker keys.

## Checkpoint

My Stores, saved verified branches, independent comparison options, same-product package sizes, reviewed alternative brands, price provenance and clearer refresh outcomes are implemented. Earlier saved-link reuse, promotions, workload controls, extension behavior and administrator health remain available.

Stage 10 adds combined registered/trial customer journeys plus handover updates. It changes tests and documentation only. The next customer step is the combined-testing checklist below; new product fixes require an exact approved file plan.

The API's Stage 9 build at `http://localhost:5392` was checked on 17 October: root 200, anonymous planning/in-store 401, and the configured local database had no pending migrations. Stage 10 did not restart the API or the user's port 3000 frontend. Do not infer current owner permissions, a clean Git tree or live retailer success from these checks; recheck runtime/Git state in a future session.

## Stack and pages

Next.js **16.3.1**, React **19.2.8**, TypeScript, Tailwind 4, Zustand **5.0.15**. Installed versions were checked in `package.json`.

| Route                         | Purpose and key files                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                           | Build/manage shopping lists; `src/components/shopping-list-app.tsx`, `shopping-list-items.tsx`, `shopping-list-item-card.tsx`; `src/stores/shopping-store.ts`                                                   |
| `/in-store`                   | Retailer-focused shopping view, purchase controls; `src/components/in-store-app.tsx`, `src/stores/in-store-store.ts`                                                                                            |
| `/settings`                   | My Stores, preferred-only comparisons, independent size/brand settings and saved branches; `src/components/shopping-preferences.tsx`, `preferred-shop-branches.tsx`; `src/stores/shopping-preferences-store.ts` |
| `/admin/shop-locations`       | Verified branch directory administration and review history                                                                                                                                                     |
| `/admin/product-alternatives` | Administrator review of different-brand product pairs                                                                                                                                                           |
| `/history`                    | Paid archived-list history; `src/components/history-app.tsx`, `src/stores/history-store.ts`                                                                                                                     |
| `/extension`                  | Local customer extension installation guidance; future store listing entry point                                                                                                                                |
| `/admin`                      | Account review, paid status, contributions and restrictions; `src/components/admin-accounts.tsx`, `src/stores/admin-store.ts`                                                                                   |
| `/admin/health`               | Shared retailer queue health; `src/components/admin-health.tsx`, `src/stores/admin-health-store.ts`                                                                                                             |
| `/api/[...path]`              | Explicit server-side backend proxy allowlist; `src/app/api/[...path]/route.ts`                                                                                                                                  |

The development script deliberately uses **Webpack** (`next dev --webpack -p 3000`). Earlier first-load restoration hangs were accompanied by repeated Turbopack HMR reconnects and improved after switching. HMR WebSocket traffic belongs to development tooling, not shopping-list updates. Do not replace application polling or re-enable Turbopack casually on the basis of old screenshots. Backend debugger pauses also caused 502/timeouts during earlier troubleshooting.

## Current user experience

- Website sign-in restores the session and displays account identity in the header. Root and in-store navigation/authentication are available. Session changes clear/reload account-specific state.
- Root is for list building at home/work: product images/names/pack details, cheapest eligible quantity total, retailer and secondary retailer prices, visible promotion wording/check time, quantity controls, notes and delete. Purchased/hidden controls belong to the in-store workflow rather than the main builder cards.
- List summary shows lowest cost across shops and each retailer's total/subtotal. Missing usable prices and incomplete retailer coverage must be obvious. Missing price is not definitive unavailability.
- Import history is secondary to product cards; ordinary shoppers should not need it to understand prices. Check current component details before changing its disclosure behaviour.
- In-store lets the shopper choose a retailer and list. The selected retailer's price dominates; better prices elsewhere are secondary. Groups distinguish selected retailer cheaper, only selected retailer, equal prices, other retailer cheaper, and missing selected-retailer price. Purchased items can be hidden/shown.
- Totals include quantities and eligible verified promotions, with incomplete totals labelled. Do not compare incomplete baskets as if they contain the same products.
- Registered free accounts have 2 active lists; paid accounts 5. Paid users can archive and see history; free users delete. Nonempty fully purchased/hidden lists auto-archive, including trials. Deleted lists do not reappear in history.
- Automatic list names use local date and daily sequence: `Shopping_List_07_10_2026_01`. Repeated customer-extension Add uses the newly supplied quantity.
- Active website import polling uses approximately 2-second intervals; do not confuse that with worker extension polling. Backend queues and retailer page loading can still delay completion.

## Current comparison experience

- My Stores persists supermarket choices and preferred-only filtering in the backend. Registered and trial customers can save settings; a trial must be converted before expiry to retain access. ALDI can be saved but is explicitly unavailable for automatic imports/comparisons and price checks; IGA/Foodland are not implemented integrations.
- Customers can search the verified branch directory by supermarket, name, suburb or postcode and save multiple branches. No GPS is required. Directory availability and a selected chain's enabled state are distinct. Saving a branch does not confirm local prices/stock; comparison context states that branch prices are unavailable and keeps addresses collapsed until expanded.
- Both list and in-store pages have a compact Comparison options panel using the same persisted settings as My Stores. Package sizes and alternative brands are independent. Saving options preserves chain/branch choices and same-page note drafts; session changes clear the previous customer's state.
- Exact prices are primary. Same-product package sizes and reviewed different-brand alternatives are separate sections when enabled and eligible saved offers exist. Unit savings and higher upfront package cost are shown together. Alternatives do not replace the original product or alter its quantity or basket totals. Different-brand products are not guaranteed equal in taste, ingredients or quality.
- `price-observation-context.tsx` renders source/coverage beside exact, historical and alternative/baseline prices. Technical collection methods use customer-facing labels. Legacy/unknown metadata is labelled `Coverage unknown — estimate`; absent observations do not manufacture source information. Public source links are separate from existing product links, use approved HTTPS product routes and discard query parameters/fragments. Contributor identity and private review evidence are not displayed.
- General totals use eligible saved `Online`, `National` or legacy `Unknown` observations under the existing freshness, currency, stock and promotion checks. Branch-linked, branch-only or unsupported-scope prices cannot establish general savings or totals.
- Price dates distinguish a usable check today (`Price up to date`) from older, unavailable or unverified dates. Product/list refresh controls report queued, running, deferred, current and `checkedUnavailable` results. A recent check without a usable price explicitly says no current comparable price is available. Mixed outcomes retain both facts. Queueing never invents a new check date or price.
- Automatic scanning is limited to stale known products still to buy. Customer refreshes use local-day checks; weekly catalogue freshness uses Australia/Adelaide Wednesday. Existing retry limits and retailer pauses apply. An available extension reader may be needed to finish queued work.

## The two Chrome extensions

### Trusted Retailer Reader: `extensions/coles-worker`

Historical directory name; reads both Coles and Woolworths. Orange tag icon, full Chrome side panel, Start/Stop worker. Uses a separately configured worker key, not a shopper's password. Local API is fixed to `http://localhost:5392`.

Idle polling is every 30 seconds. Receives the waiting list, claims and processes one task at a time in an extension-owned tab, submits before proceeding, and retains pending submissions for recovery. Active page extraction checks roughly every second, with a 90-second page deadline. Server leases/retries and shared retailer workload controls apply. Stop finishes current work and stops taking new assignments; closing the side panel does not stop work. Never close or navigate customer-owned tabs. Reload/crash-restored orphan tabs may need manual closure.

### Customer Add to your list: `extensions/shopping-list`

Blue basket icon, separate customer-facing extension intended for future Chrome Web Store publication. Current build is local-test only. Shares the website session in the same Chrome profile through the permitted localhost cookie/session bridge; users should not repeatedly sign in. Server extension-origin allowlisting remains required. A published stable extension ID should be configured centrally, not individually by each customer.

- First toolbar open per Chrome session is the full side panel.
- On supported retailer pages, a signed-in user can minimize to a small right-side panel roughly two-thirds down. Shows current/default list, quantity, Add, expand and hide. Add only works on a product page; full panel changes selected list.
- On other pages toolbar opens full view and Minimize is disabled. Navigating away closes the full view. Hide, including Chrome's close control, persists until toolbar click.
- Add reads the current source page, saves through server validation, reuses fresh exact comparison data or opens a temporary comparison tab. Personal comparisons start only after Add. Navigation/current product identity must be rechecked to avoid stale evidence.
- Separate **Help refresh shared prices** is on by default, with opt-out. Signed-in idle customers ask for one shared task roughly every minute, backing off to five minutes on empty/error. Personal Add takes priority. Sign-out/opt-out stops shared polling. Server tracks contributor ID/outcome; restrictions are server-enforced.
- Source page is never navigated/closed for comparisons. Background tasks use owned tabs, close them when finished, and recover/retry submissions without duplicate writes.
- Reload through `chrome://extensions` after changing extension files. A Chrome restart is normally unnecessary; existing page content scripts may need a page refresh. Test genuine browser-start behaviour separately when relevant.

Read each extension's `README.md`, `manifest.json` and current scripts before editing. Both use plain packaged JS/assets; no npm build step is needed for unpacked loading. Keep extraction behaviour and regression coverage aligned across readers. Some README paragraphs document older stages and must be checked against current code.

## Latest health page

Manual refresh plus every 30 seconds while visible; hidden tabs pause, visible tabs resume. API 401/403 clears old statistics and stops automatic refresh. Temporary failures clearly label a retained snapshot as potentially outdated. Zustand store cancels stale requests.

Displays retailer waiting/processing/failed counts, expired leases, oldest task creation age, latest retained outcomes over 24 hours, recent retained block reports, pause/recovery status, and common current failures. Read the backend handover for metric limitations. This page is administrator-only at the API; a page URL is not authorization. No schema change is needed for this page.

## Commands and local setup

`.env.example` points the proxy to `http://localhost:5392`; `MYSHOPPINGLIST_PUBLIC_ORIGIN` must match the actual browser-facing origin for the relevant server. Do not overwrite private environment configuration casually.

From `D:/pra/myshoppinglist`, after checking port 3001 is free:

```powershell
npm run dev -- --port 3001
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run lint
npm run test:regression
```

User's `npm run dev` defaults to 3000. Current `npm run start` defaults to 3001. `playwright.config.ts` starts its own isolated frontend at 3001, using `.next-playwright` and a fake upstream at 5499 for suites that provide one; `reuseExistingServer` is false. Do not run it alongside another 3001 server.

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
node node_modules/@playwright/test/cli.js test tests/shopping-comparison-workflow.spec.ts --reporter=line
```

This machine previously resolved a broken user-level npm shim; putting Program Files Node first fixed test startup. Direct fallback is `node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' ...`. Browser/process startup may need tool sandbox approval. Never bypass approval by stopping user processes.

Prettier was available at `C:/Users/yeqin/.vscode/extensions/esbenp.prettier-vscode-12.4.0/node_modules/prettier/bin/prettier.cjs`; verify availability in a future session. Format only approved files. TypeScript check can avoid incremental output with `--incremental false`.

## Test evidence and regression maintenance

Stage 10's final selected run passed **22 desktop/mobile cases**, including all 4 new registered/trial combined journeys. The companion backend regression run passed **88 tests, 0 skipped**, including both new authenticated endpoint workflows. TypeScript, targeted ESLint and whitespace checks passed. Combined-flow screenshots were inspected for desktop and mobile.

The browser journey saves a branch, filters retailers, changes alternatives independently, checks source labels/links, preserves a same-page unsaved note during settings/refresh, navigates to in-store shopping, verifies historical prices/pending work, selects restricted-only stores and switches to a separate account. Existing selected checks cover persisted toggles, multiple saved branches, per-price provenance and mixed product/list refresh outcomes.

To reproduce the selected 22-case run from this directory, with port 3001 free:

```powershell
$comparisonFiles = 'tests/shopping-comparison-workflow.spec.ts', 'tests/comparison-preferences.spec.ts', 'tests/preferred-shop-branches.spec.ts', 'tests/price-observation-context.spec.ts', 'tests/price-refresh-outcomes.spec.ts'
npx playwright test @comparisonFiles --grep 'customer carries|independent toggles persist|multiple branches and supermarkets persist|associates provenance|explains mixed outcomes' --reporter=line
```

These browser cases intercept API responses with controlled fixtures. The companion backend suite exercises authenticated ASP.NET endpoints and isolated PostgreSQL schemas. Neither establishes a complete browser-to-live-API-to-retailer workflow or today's real retailer access. Screenshots are generated under ignored `test-results/` and are overwritten by subsequent Playwright runs.

Earlier Stage 9 results: 33 backend and 58 desktop/mobile checks passed, plus TypeScript, lint and API build. Earlier Stage 8B verified 64 new provenance checks and 140 relevant regression cases; one existing brand test hit an asynchronous route-teardown race and passed in isolation. Older health/extension/backend milestone totals are historical, not fresh all-suite results for this stage.

Browser regression collection: `extensions/coles-worker/tests/fixtures/regression.json`, runner `extensions/coles-worker/tests/regression.test.mjs`; it exercises both extension readers. Backend collection and provenance guidance: `D:/pra/myshoppinglist-api/tests/myshoppinglist-api.Tests/Fixtures/Regression/README.md`. Saved cases include YoPro, McCain, Red Island, Hans, Cadbury, Pickers, Four'n Twenty, Banana Boat and punctuation/variant/pack/promotion failures. Many are reduced reconstructed examples, not live page captures. Run the collections whenever extraction or matching changes.

Fixtures/mocked browser tests do not guarantee today's live retailer access. Blocking must be reported and backed off, not mislabelled as no match or bypassed.

## Customer combined-testing checklist

Use a customer-owned test list. Saved catalogue records determine what can be shown: use a product with verified Coles/Woolworths mappings where possible, a qualifying saved different-size offer, and a currently approved brand relationship. Empty alternative sections can be correct when these prerequisites are missing. Do not seed invented prices or branches into normal customer data to make a comparison look complete.

1. Open the user's frontend on port 3000 and sign in or use an active trial. Confirm the expected identity and list. The API should be running on 5392; only start a separate Codex frontend on a free 3001.
2. In My Stores, enable Coles/Woolworths, choose preferred-only comparisons, save and reload. If verified directory branches exist, search by suburb/postcode and save one or more. Verify their addresses and the explicit lack of branch-price confirmation. An empty directory requires legitimate administrator-reviewed entries, not fabricated location data.
3. Disable one chain, save, return to the list and check comparison results respect that choice. The original list item/quantity must remain. Re-enable it and confirm eligible saved results return. A saved branch may remain while its chain is disabled, with an appropriate notice.
4. Try both comparison toggles independently and together in the inline Comparison options panel. Verify the corresponding sections, reload/navigation persistence and unchanged chain/branch choices. Larger packages may cost more upfront despite lower unit prices. Brand alternatives must remain clearly distinct from exact products.
5. Check source/coverage labels and open an available price-source link. Unknown coverage must remain an estimate; no source link should be invented. Today's usable prices say up to date, older prices retain their date, and unavailable prices do not become current solely because they were checked recently.
6. Refresh a product and the whole list where enabled. Expect a queue/current/deferred/unavailable explanation appropriate to the result, including mixed outcomes. Repeated clicks must not create duplicate work or bypass cooldowns. If an extension reader is not available, waiting for a reader is expected; queueing alone must not change the displayed observation date or price.
7. While staying on the list page, edit a note without saving and change comparison options or refresh. The draft and quantity should remain. Save or discard the draft before navigating away: unsaved drafts are not promised across navigation, reload or sign-out.
8. Open Shop in store and the same list. Check saved options, branch context, price dates, previous observations and partial retailer coverage. Select a retailer and verify its price leads the display. Purchase/undo controls should work; marking every remaining item purchased/hidden automatically archives a nonempty list.
9. Select only ALDI in My Stores. Expect its unavailable automatic-comparison explanation and no fabricated current comparisons. Restore the desired stores afterwards.
10. Sign out or switch to a separate account/trial you control. The previous customer's list, branch selections and drafts must disappear. Their preferences must not become the new account's defaults. Report reproducible failures with the page, action and expected/actual result, without sharing tokens or credentials.

## What remains / suggested next discussion

- The checklist above and a small permitted live website/extension smoke test are still customer/runtime work. Observe actual queue completion, saved-link reuse, stale refresh and verified multibuy quantities separately from fixture results. Retailer blocking/layout changes are not disproved by passing automated tests; do not bypass challenges.
- Branch-specific collection and automatic ALDI comparisons are unavailable. Different-brand results require eligible current reviews. Comprehensive retailer coverage is not promised.
- Production and Chrome Web Store release need a separately approved plan: HTTPS domain/API, stable extension ID, cookie/origin/host permissions, packaging, privacy disclosures, support details and installed-build verification. The extension entry point currently provides local installation guidance.
- Billing, paid analytics, additional retailer integrations, full historical queue metrics and account recovery are not established as complete here. Plan changes only from current requirements and observed evidence.
- Some root README/extension README stage descriptions are historical. Use current code, tests and both handovers to establish behavior. This stage modifies acceptance tests/documentation and adds no migration or application feature.

## New-chat starter

> Continue MyShoppingList. Read D:/pra/myshoppinglist/HANDOVER.md and D:/pra/myshoppinglist-api/HANDOVER.md, plus applicable instructions. Verify current Git/runtime state first. Do not edit any files until I approve an exact file-by-file plan. Port 3000 is mine; use 3001 only if free. We have completed My Stores, saved branches, comparison options, size/brand alternatives, provenance, clearer refresh outcomes and combined workflow acceptance checks. Review the current verification boundaries and customer checklist results before proposing the next change.
