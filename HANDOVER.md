# MyShoppingList frontend and extensions handover

Updated 7 October 2026 (Australia/Adelaide). Also read [backend handover](../myshoppinglist-api/HANDOVER.md), which covers processing, database, business rules and detailed status. These files are continuation context, not permission to start new edits.

## User's working rules

Before changing any file, explain the intended outcome, exact file list and changes, why each is needed, and ordered steps; then wait for approval. Only change approved files. Ask about ambiguity. Explain actions before doing them and always format code. Preserve unrelated changes.

**Port 3000 belongs to the user. Codex uses 3001.** Never stop/restart the user's frontend. Ask if 3001 is occupied before stopping its process or choosing another port. Use a command-line override rather than changing defaults. Use **Zustand** for global state. No subagent work is currently requested.

Read `AGENTS.md` before coding. It requires reading relevant installed Next.js documentation in `node_modules/next/dist/docs/`, because this version's APIs may differ from remembered ones. `CLAUDE.md` references that file. Never document credentials or worker keys.

## Checkpoint

All five recently requested areas have implementations: saved retailer-link reuse, quantity-aware promotions, shared workload controls, permanent regression examples and administrator health. Latest feature: `/admin/health`, linked from `/admin`. No further implementation is explicitly approved at this checkpoint.

Before this handover was created, frontend Git was clean at `a12be27` (`admin page update`). Backend was clean at `f58b1eb`. This supersedes older chat notes about pending uncommitted edits. No live browser, server process or database was checked during this documentation task. The previous turn asked the user to restart the backend for the new health endpoint; that restart is unverified.

## Stack and pages

Next.js **16.3.1**, React **19.2.8**, TypeScript, Tailwind 4, Zustand **5.0.15**. Installed versions were checked in `package.json`.

| Route | Purpose and key files |
| --- | --- |
| `/` | Build/manage shopping lists; `src/components/shopping-list-app.tsx`, `shopping-list-items.tsx`, `shopping-list-item-card.tsx`; `src/stores/shopping-store.ts` |
| `/in-store` | Retailer-focused shopping view, purchase controls; `src/components/in-store-app.tsx`, `src/stores/in-store-store.ts` |
| `/history` | Paid archived-list history; `src/components/history-app.tsx`, `src/stores/history-store.ts` |
| `/extension` | Local customer extension installation guidance; future store listing entry point |
| `/admin` | Account review, paid status, contributions and restrictions; `src/components/admin-accounts.tsx`, `src/stores/admin-store.ts` |
| `/admin/health` | Shared retailer queue health; `src/components/admin-health.tsx`, `src/stores/admin-health-store.ts` |
| `/api/[...path]` | Explicit server-side backend proxy allowlist; `src/app/api/[...path]/route.ts` |

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
node node_modules/@playwright/test/cli.js test tests/admin-health.spec.ts tests/admin.spec.ts --reporter=line
```

This machine previously resolved a broken user-level npm shim; putting Program Files Node first fixed test startup. Direct fallback is `node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' ...`. Browser/process startup may need tool sandbox approval. Never bypass approval by stopping user processes.

Prettier was available at `C:/Users/yeqin/.vscode/extensions/esbenp.prettier-vscode-12.4.0/node_modules/prettier/bin/prettier.cjs`; verify availability in a future session. Format only approved files. TypeScript check can avoid incremental output with `--incremental false`.

## Test evidence and regression maintenance

Previous latest health run: **12 desktop/mobile browser tests passed**, including existing administration tests, refresh/access loss, stale snapshot messaging, hidden-tab pause/resume and horizontal overflow. Backend had **2 passing health database tests**. TypeScript, ESLint and diff checks passed. These were not rerun for this documentation-only task.

Earlier permanent-regression milestone reported **139 extension tests and 2,315 backend tests passing**; that is historical evidence, not a fresh all-suite run after every later change.

Browser regression collection: `extensions/coles-worker/tests/fixtures/regression.json`, runner `extensions/coles-worker/tests/regression.test.mjs`; it exercises both extension readers. Backend collection and provenance guidance: `D:/pra/myshoppinglist-api/tests/myshoppinglist-api.Tests/Fixtures/Regression/README.md`. Saved cases include YoPro, McCain, Red Island, Hans, Cadbury, Pickers, Four'n Twenty, Banana Boat and punctuation/variant/pack/promotion failures. Many are reduced reconstructed examples, not live page captures. Run the collections whenever extraction or matching changes.

Fixtures/mocked browser tests do not guarantee today's live retailer access. Blocking must be reported and backed off, not mislabelled as no match or bypassed.

## What remains / suggested next discussion

1. Confirm the backend restart, then verify `/admin/health` with the owner's admin session and real queue activity.
2. Perform a small live end-to-end smoke test: website Add, customer extension Add, saved-link reuse, stale refresh and verified multibuy quantities. Keep this distinct from automated fixture results.
3. Investigate only concrete failures with logs and reproducible evidence; propose an exact approved file plan before fixing.
4. Production and Chrome Web Store release need a separate plan: HTTPS domain/API, stable published extension ID, cookie/origin/host permissions, packaging, privacy policy, screenshots, support details and installed-build tests. Root Add extension entry currently leads to local installation guidance.
5. Billing integration, paid analytics, additional retailers, full historical queue metrics and account recovery are future areas, not promises already delivered by this checkpoint.

No application code was changed as part of this handover. Existing README stage descriptions can be outdated; use code, tests and both handovers to establish current behaviour.

## New-chat starter

> Continue MyShoppingList. Read D:/pra/myshoppinglist/HANDOVER.md and D:/pra/myshoppinglist-api/HANDOVER.md, plus applicable instructions. Verify current Git/runtime state first. Do not edit any files until I approve an exact file-by-file plan. Port 3000 is mine; use 3001 only if free. We have completed saved links, promotions, workload controls, regression fixtures and admin health. Check the latest integration status, then discuss the next priority.
