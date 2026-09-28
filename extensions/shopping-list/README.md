# MyShoppingList user extension — local test

This is the shopper's add-to-list extension, separate from `coles-worker` (the retailer reader).

## Install locally

1. Run the API at `http://localhost:5392` and the website at `http://localhost:3000`.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this `extensions/shopping-list` folder.
3. Copy its 32-character extension ID from Chrome's extension card (also shown under Local setup in the popup).
4. Configure the API with `UserExtension:AllowedExtensionIds:0` set to that ID, for example in your private `appsettings.Local.json`:

   ```json
   "UserExtension": { "AllowedExtensionIds": ["YOUR_32_CHARACTER_EXTENSION_ID"] }
   ```

   Merge that section into the existing JSON object; do not replace existing settings. Alternatively set environment variable `UserExtension__AllowedExtensionIds__0` for the API process. Restart the API. No extension is allowed by default. The ID is an allowlist identifier, not a secret or a replacement for signing in.
5. Pin the extension using Chrome's Extensions menu. Open a Coles or Woolworths product, click the extension, and sign in with your existing MyShoppingList account.
6. Choose a list if there are several, set quantity, and click **Add to list**. With no active lists, a default list is created automatically. The extension reads this product page and saves it to your list. If the other retailer has a fresh exact match in the database, that price is reused. Otherwise the extension opens one background tab, searches and reads candidates, and sends evidence to the server. The server validates identity and price evidence; ambiguous matches are not marked exact.

Work starts only when you click Add and is limited to that import. There is no polling for unrelated jobs. You can close the popup while Chrome remains open. The temporary comparison tab is reused and closed on completion or failure; the original product tab is never closed or navigated. Status and pending submissions are kept in session storage so service-worker suspension and lost responses can recover. Retry replays the same request ID/step token. A 90-second page timeout or failed comparison keeps the saved source product and offers Retry comparison. After a Chrome restart, sign in and click Add again on the source page; existing list items are preserved. Server claims expire after ten minutes of inactivity. Session storage does not survive a browser restart, so any tab restored by Chrome after a crash may need to be closed manually.

## Data and permissions

- `activeTab`: identify the current product tab when you open the extension.
- `scripting` and retailer host permissions: read bounded product JSON and search links from Coles and Woolworths. Only the current product and the extension-created comparison tab are read after Add. No account details or whole-page HTML are sent.
- `alarms`: resume only an active import after service-worker suspension. The alarm is cleared when work completes or fails.
- `storage`: keep the session token in `chrome.storage.session`; it is cleared when Chrome restarts. Passwords are never saved. Signing out revokes the extension session when the server is reachable and always clears local credentials.
- `http://localhost/*`: Chrome host patterns do not restrict ports; the implementation sends API requests only to the fixed `http://localhost:5392` base. No cookie access, background browsing history collection or worker key. The packaged extractor is injected only for active import work.
- Submitted data: account email/password at sign-in; chosen list, quantity, canonical product URL, bounded product evidence and comparison search links when adding. No analytics, remote executable code or automatic collection.

## Tests

From the frontend: `node --test extensions/shopping-list/tests/extension.test.mjs`.

## Before Chrome Web Store publication

This local version is not ready for public installation. Set the production HTTPS API in `background.js`, replace localhost host permission with the production host, update website links in `popup.html`, remove the local-test name and setup text, and configure the published extension ID on the server. Add approved artwork/icons, screenshots, a public privacy policy, support/contact URLs, a store description, and accurate privacy/permission disclosures. Verify production sign-in, expiry, imports, list selection and accessibility in an installed Chrome build. Package only runtime files (manifest, background, content.js, popup HTML/JS/CSS and approved assets), excluding tests and this README. Publish through the owner's Chrome Web Store developer account after review. Replace the website's installation instructions link with the published listing when available.

Chrome references: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab and https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
