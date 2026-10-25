# MyShoppingList personal product extension — local test

Version 0.6.0 reads a product only after you click **Read product**. It shows the server-validated name, pack, price and observation date before you click **Save to list**. Products and observations belong to the signed-in account. It does not collect shared prices, search other retailers, open comparison tabs or run timed collection.

## Staged rollout

This version requires the updated private-capture API. `UserExtension:PersonalCapturesEnabled` remains **false by default**. Installing the extension does not enable it. Until rollout is approved, previews report that personal capture is not enabled; they never fall back to shared imports.

Do not enable personal mode as an isolated extension update. Website controls and the legacy-data transition must be reviewed first. Enabling personal mode also disables the import, pack discovery, brand discovery and price refresh workers, rejects old collection submissions, and returns no shared work to older extensions. Existing database data is retained.

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
- No alarms permission, idle collection, analytics, remote executable code or retailer background tabs.

## Checks

Run `node --test extensions/shopping-list/tests/extension.test.mjs` from the frontend repository. This covers capture intent, cancellation, retries, account boundaries, navigation, list ownership, extraction and panel authorization. Installed Chrome integration and live retailer behaviour require separate verification during rollout.

## Publication

This is an unpacked local test extension, not a Chrome Web Store release. Before publication, configure production HTTPS API/website origins, cookie domain checks and website bridge matches; replace localhost permissions and links; configure the published extension ID; add screenshots, privacy policy and support information; and verify the complete installed-extension workflow. Package runtime files and icons only, excluding tests and this README. Publish through the owner's store account after review.