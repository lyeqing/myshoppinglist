# MyShoppingList Coles Reader — local proof of concept

This unpacked Manifest V3 extension reads a Coles product in a normal Chrome tab on your computer. It does not poll the MyShoppingList server or submit data yet. No API key, frontend server, npm install, or extension build is needed.

## Load in Chrome

1. Prefer a dedicated Chrome profile for this test. Open `chrome://extensions` in that profile.
2. Turn on **Developer mode**, then choose **Load unpacked**.
3. Select `D:\pra\myshoppinglist\extensions\coles-worker` (the folder containing `manifest.json`).
4. Pin **MyShoppingList Coles Reader** from Chrome's Extensions menu.
5. Open the extension, paste a Coles product URL, and select **Read product**.
6. The first read opens a background Coles worker tab. Later reads navigate that same tab to the requested product. Allow up to 90 seconds while Chrome is running and the computer is awake. Open that tab if it needs your attention.
7. Reopen the extension to see the result. Closing the popup does not cancel the task. Leave the worker tab open for further reads, or close it; the next read will create a replacement. Closing it during a read ends that task with a tab-closed error.

After code updates, select **Reload** on the extension card before testing again. Remove the extension through `chrome://extensions` when no longer needed.

Reloading the extension or restarting Chrome clears its session-stored worker tab ID. Close any old test tabs yourself after reloading; the extension will not adopt or close existing tabs. During a session, the worker tab stays reserved for product reads, so use a different tab for your own browsing.

## Three live checks

- Supreme Pizza: https://www.coles.com.au/product/coles-kitchen-supreme-pizza-445g-1435461?pid=meals-hub_productlist_oven-faves
- Chicken Kyiv Pizza: https://www.coles.com.au/product/coles-kitchen-limited-edition-chicken-kyiv-pizza-500g-1435392
- Coca-Cola: https://www.coles.com.au/product/coca-cola-classic-soft-drink-bottle-1.25l-123011

For each, compare the name, product ID, pack and single-item price with the actual Coles tab. Compare multibuy offers separately. Record any error code from Extraction details or error message. Prices may change; tests do not assume today's live prices.

Success means the exact product and usable single-item price are returned in your actual Chrome profile. A successful fixture test is not a successful live check. Server task polling is a separate approval stage after these checks.

## What it reads and stores

- Only matching product JSON-LD and `__NEXT_DATA__` from the rendered page; it does not execute scripts found in that data or guess products from titles.
- Single-item price, pack label when available, promotion, unit price, stock flag and extraction timestamp.
- Only delivery/collection mode and postcode when an identifiable header button exposes them. Missing context stays unknown. All prices remain **unverified browser context**, never assumed national or local-to-you.
- Only the latest task/result and the extension-created worker tab ID in extension session storage. Reloading/disabling the extension or restarting Chrome clears them. No browsing history, cookies, credentials, full HTML, account name or address is collected or uploaded by this extension. Chrome still makes its normal requests to Coles to load the tab.

Permissions: `scripting` for reading the created Coles tab; Coles-only host access; `storage` for the latest task/result; `alarms` for retries and timeout recovery. No general tabs/history/cookies permission and no remote executable code.

## Behaviour and limitations

- One active task at a time. Chrome alarms wake the background worker every 30 seconds during a read; completion events also trigger extraction. Progress survives worker suspension and closing the popup, not a full browser restart.
- One reusable worker tab per extension session, including after failed reads. Only the tab created and tracked by the extension is navigated. Other tabs are never selected, reused, or closed; the extension does not automatically close any tabs.
- A 90-second deadline is checked on wake-up; sleeping computers or delayed alarms can delay reporting the timeout.
- Conflicting prices produce a verified identity with an unavailable price. Multibuy rewards and related product prices never replace the single-item price.
- Access challenges are reported and not bypassed. This extension cannot guarantee Coles availability or server-hosted browser reliability.
- Structure changes or product pages without matching embedded data may fail. Header location extraction is best-effort, not proof of the price's store.
- Start with the three packaged-product examples. Variable-weight items need additional validation before production use.

## Developer checks

From `D:\pra\myshoppinglist`:

```powershell
node --test extensions/coles-worker/tests/extraction.test.mjs
npx eslint extensions/coles-worker
```

Tests use Node's built-in test runner and controlled snapshots/Chrome API mocks; no retailer requests or installed Chrome changes. No frontend/backend configuration changes are required.
