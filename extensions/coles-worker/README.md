# MyShoppingList Coles worker

This unpacked Chrome extension polls http://localhost:5392/api/coles-worker every 30 seconds while enabled. It receives the full waiting list, claims one task, reads its product or search page in one reusable tab, and submits the result before starting another task. Keep Chrome running and the computer awake; the popup can be closed. No npm install or extension build is needed.

## Connect to the local API

1. Configure a random worker key of at least 32 characters in the API environment as `ColesExtension__WorkerKey`. Use the same key in the extension. This is a worker credential, not your MyShoppingList account password. An absent key disables worker access.
2. Start/restart the updated API on http://localhost:5392. The AddColesExtensionTasks migration must have been applied to MyShoppingList.
3. Open chrome://extensions, enable Developer mode, and load `D:\pra\myshoppinglist\extensions\coles-worker`, or click **Reload** if already installed. Approve its additional localhost host permission if Chrome requests it.
4. Open the extension popup, paste the key into **Worker key**, and select **Start worker**. It should show **Connected**. Later, leave the key field blank to retain the saved key.
5. Add a Coles URL in MyShoppingList. Fresh catalogue data is reused; otherwise the worker opens its Coles tab and processes the request. Results appear after the API resumes the import, normally within another 30 seconds.

Example PowerShell setup in the API terminal (the key is copied to your clipboard for the popup and is not printed):

```powershell
$env:ColesExtension__WorkerKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
Set-Clipboard -Value $env:ColesExtension__WorkerKey
dotnet run --no-launch-profile --urls http://localhost:5392
```

That key lasts for the terminal session. For later API terminals, configure the same secret through your normal environment/secret management. Do not commit it to source control. A changed key must also be entered in the extension. The endpoint is fixed to the local test API; remote deployment needs a separate HTTPS configuration change.

## Queue and recovery

- Only one task is claimed per worker at a time. Each lease lasts three minutes; a page read has a 90-second deadline. Subsequent tasks do not lose their leases while waiting in the batch.
- A result is kept in extension local storage until the server acknowledges it. Temporary connection failures retry the same submission without duplicating catalogue/history writes. No new task starts while a result awaits acknowledgement.
- Temporary page/network failures and expired leases retry up to three attempts. Access restrictions and invalid evidence become failed tasks. Failed tasks remain visible with a **Retry** button. Retry also requeues associated failed imports.
- When the worker is offline, unclaimed requests remain waiting without consuming attempts. Other retailer processing can continue.
- **Pause worker** stops new assignments; a current read finishes. If its result cannot be submitted, resume the worker to continue delivery. Manual **Read product** is available while paused.
- Closing the worker tab during a read reports a failure. The next task opens a replacement. The extension never adopts or closes your other tabs.
- Reloading the extension or restarting Chrome clears the session tab ID. Close any old worker tab yourself after reloading. The saved key, enabled setting and pending submission survive; abandoned server leases expire and recover.

## Freshness and validation

Coles and Woolworths catalogue freshness starts at the latest Wednesday 00:00 Australia/Adelaide, including daylight saving. Expired promotions are not reused. Server code validates product IDs, structured evidence, single-item prices, currencies and exact comparison matches before saving. Searches return at most five unique candidate URLs from the actual result container; recommendations beneath an explicit empty result do not become matches.

The extension sends only main-product structured data or candidate URLs. It does not send full HTML, cookies or application/account state. The local popup can display an unverified delivery postcode, but this is not submitted. Prices retain an unknown store scope; they are not claimed to be national or your local-store price. Multibuy rewards and variant prices do not replace single-item prices. Access challenges are reported, not bypassed.

Permissions: scripting for the worker tab, storage for settings/results, alarms for polling, Coles host access, and localhost host access. Chrome host permissions cannot restrict by port; background requests are hard-coded to port 5392. The key is stored in extension local storage restricted to trusted extension contexts, never in content scripts or result JSON.

## Verify

```powershell
node --test extensions/coles-worker/tests/extraction.test.mjs
npx eslint extensions/coles-worker
```

Tests use controlled snapshots and mocked Chrome/network APIs. For a live check, add the Supreme Pizza URL, watch the worker tab, verify the saved price against Coles, then add the same product again to verify cache reuse. Test several queued URLs, pause/resume and an API interruption. Actual retailer availability still depends on Chrome access and Coles page structure.
