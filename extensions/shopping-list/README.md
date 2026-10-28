# MyShoppingList personal product extension — local test

Version 0.7.0 supports two explicit actions: **Read product** to review and save a product, and the website's **Refresh items** to update existing private prices. Products and observations belong to the signed-in account. It does not collect shared prices, search other retailers or run timed collection.

## Refresh saved prices

After updating this folder, reload the unpacked extension in `chrome://extensions`, restart the API with the updated build, and reload the website tab. The extension bridge works on `http://localhost:3000` and `http://localhost:3001` in the same Chrome profile.

On either shopping page, **Refresh items** checks the extension connection, then reads known Coles, Woolworths and ALDI product pages one at a time in temporary inactive tabs. Only existing private mappings for items still to buy are eligible; purchased and hidden items are skipped. This action updates price observations without adding products or changing quantities, notes or item states. The website reloads saved results as they arrive. Prices remain observations from the user's browser; store location is not verified.

Progress shows checked and updated counts. **Cancel refresh** stops further work and retains observations already saved. Navigating away or changing accounts cancels the website's run. An interrupted worker requires starting Refresh items again; it never reports unfinished work as completed. Only temporary tabs created by this workflow are closed.

If the extension cannot be reached, the website offers **Installation instructions** and **Try again**. This is an unpacked local test, not a Web Store release. Enable the extension in `chrome://extensions`, or use Developer mode → Load unpacked with this folder; the API owner must allow the extension ID. Reload the website after installation or extension reload.

Blocked pages, redirects, missing prices and product identity conflicts are reported as unsuccessful updates; previous observations are retained. Open the affected retailer product to complete verification yourself, then try again. The refresh does not bypass retailer challenges, discover new matches or silently fall back to shared workers.

## Staged rollout

This version requires the updated private-capture API. `UserExtension:PersonalCapturesEnabled` remains **false by default**. Installing the extension does not enable it. Until rollout is approved, previews report that personal capture is not enabled; they never fall back to shared imports.

Do not enable personal mode as an isolated extension update. Website controls and the legacy-data transition must be reviewed first. Enabling personal mode also disables the import, pack discovery, brand discovery and price refresh workers, rejects old collection submissions, and returns no shared work to older extensions. Existing database data is retained.

The approved local rollout has completed its PostgreSQL private-copy conversion. Its ignored API configuration now enables personal captures and explicitly disables legacy import/refresh workers. Start or restart the local API to load that configuration. This does not enable other installations or publish the extension; retain the extension ID already configured for your unpacked installation.

The frontend's separate `playwright.personal.config.ts` tests the unpacked extension with a real API and isolated PostgreSQL schema. It opens a fresh Chromium window to exercise native toolbar/side-panel focus. It owns test ports 5392 and 3001, creates disposable accounts and a temporary Chromium profile, and verifies that the application's public tables remain unchanged. Stop a local API you own before running it. Supply matching `MYSHOPPINGLIST_TEST_CONNECTION` and `PG*` credentials privately as described in the API README, build the API, then run `node node_modules/@playwright/test/cli.js test --config playwright.personal.config.ts`. The ordinary mock-API suite skips this journey. The journey passed during local activation, including two-account isolation and zero collection tasks. These automated retailer pages are controlled fixtures; live retailer extraction and the user's installed Chrome profile still require a separate manual check.

## Local setup after rollout approval

1. Run the API at http://localhost:5392 and the website at http://localhost:3000. Codex development servers use port 3001; the user's server on 3000 is reserved.
2. Open chrome://extensions, enable **Developer mode**, choose **Load unpacked** and select this extensions/shopping-list folder.
3. Copy the extension's 32-character ID. The API owner must add it to `UserExtension:AllowedExtensionIds`; no extension is allowed by default. Merge settings with the existing private configuration. The ID is an allowlist identifier, not a credential.
4. Once the complete rollout is approved, the API owner enables `UserExtension:PersonalCapturesEnabled` and restarts the API. Reload the unpacked extension after updating it.
5. Pin **MyShoppingList — Add to list (Local test)**. Open a Coles, Woolworths or ALDI product page and click the toolbar icon. Website and extension share sign-in in the same Chrome profile.

## Save a product

Choose your shopping list and quantity. Click **Read product**, review the extracted name, pack and price, then **Save to list**. **Cancel** discards the preview without saving. Reading a preview does not create a product, observation or list. If no active list exists, a list named using your local date is created only when you save.

Missing prices are labelled unavailable; you can save the product without a price. The date describes when you read the page, not a live price guarantee. Store location remains unverified. To compare retailers, visit and save each product yourself. Unsupported pages, conflicting identities and inaccessible product data require checking the page and reading again.

Saving requires the same active product tab used for the preview. Navigation never starts another read automatically. There is no automatic verification loop: complete any retailer verification yourself, then choose **Read product**.

## Safe retries

If a save times out or its reply is lost, **Retry save** sends the exact same list, quantity, evidence, observation date and request ID. It does not reread the page or add the item twice. A pending save locks quantity/list changes and new reads until its outcome is resolved. Closing or hiding the panel does not cancel an already submitted save.

The pending request survives service-worker suspension while Chrome remains open. Session storage does not survive a full Chrome restart, extension reload/removal or profile reset. After those events, check your list before starting a new capture if the previous outcome was uncertain. Signing out or changing account discards cached evidence and pending work so it cannot be submitted under another account.

## Full and compact panels

Chrome 142 or newer is required. The first toolbar click opens the full side panel. Signed-in shoppers on supported retailer pages can minimize to a compact, scrollable panel. Both views provide the same review-before-save flow and list selection. Expand opens the full view; Hide stays hidden until another toolbar click. On other websites, use the full panel and open a supported product to read it.

Compact controls run in an isolated extension frame with a per-tab ticket. Retailer page scripts cannot initiate a capture. Opening, minimizing, hiding or navigating does not extract products.

## Data and permissions

- activeTab, retailer host permissions and scripting: read bounded product JSON from the selected product tab after a user action; display the compact frame on supported retailer pages.
- sidePanel: display the full extension interface.
- storage: keep account session, preview, panel preferences and an unconfirmed request in trusted chrome.storage.session. Passwords are never stored. Evidence and bearer tokens are not returned to retailer pages or UI message responses.
- cookies: share the HTTP-only MyShoppingList session cookie with the website. Sign-out affects both.
- localhost host permission: Chrome host patterns cannot restrict ports. API calls use the fixed localhost:5392 origin. The website bridge only notifies ports 3000 and 3001 of session changes without sending credentials.
- Submitted capture data: chosen list, quantity, canonical product URL, bounded product evidence, observation date and a unique request ID. The server derives ownership from authentication. Sign-in sends email/password to the API.
- No alarms permission, idle collection, analytics or remote executable code. Temporary retailer tabs are opened only for an explicit website price refresh.

## Checks

Run `node --test extensions/shopping-list/tests/extension.test.mjs` from the frontend repository. This covers capture intent, cancellation, retries, account boundaries, navigation, list ownership, extraction and panel authorization. Installed Chrome integration and live retailer behaviour require separate verification during rollout.

## Publication

This is an unpacked local test extension, not a Chrome Web Store release. Before publication, configure production HTTPS API/website origins, cookie domain checks and website bridge matches; replace localhost permissions and links; configure the published extension ID; add screenshots, privacy policy and support information; and verify the complete installed-extension workflow. Package runtime files and icons only, excluding tests and this README. Publish through the owner's store account after review.
