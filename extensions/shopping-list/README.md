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
5. Pin the extension using Chrome's Extensions menu. Open a Coles or Woolworths product, click the extension, and use your existing website sign-in. You can also sign in from the extension; both share the same session.
6. Choose a list if there are several, set quantity, and click **Add to list**. With no active lists, a list is created automatically using your local date, for example `Shopping_List_04_10_2026_01`. Subsequent automatically created lists that day use the next number; existing names are preserved. The extension reads this product page and saves it to your list. If the other retailer has a fresh exact match in the database, that price is reused. Otherwise the extension opens one background tab, searches and reads candidates, and sends evidence to the server. The server validates identity and price evidence; ambiguous matches are not marked exact.

Personal imports start when you click Add. Shared collection defaults to on for signed-in customers and can be disabled with Help refresh shared prices. While idle the extension asks for one reserved task every minute, backing off to five minutes when no work is available or on errors. Personal Add takes priority, closing any shared task tab; unfinished claims expire for another worker. You can close the popup while Chrome remains open. The temporary comparison tab is reused and closed on completion or failure; the original product tab is never closed or navigated. Status and pending submissions are kept in session storage so service-worker suspension and lost responses can recover. Retry replays the same request ID/step token. A 90-second page timeout or failed comparison keeps the saved source product and offers Retry comparison. After a Chrome restart, your website sign-in remains available until its session expires. Click Add again on the source page to resume an unfinished personal import; existing list items are preserved. Server claims expire after ten minutes of inactivity. Session storage does not survive a browser restart, so any tab restored by Chrome after a crash may need to be closed manually.

## Data and permissions

- `activeTab`: identify the current product tab when you open the extension.
- `scripting` and retailer host permissions: read bounded product JSON and search links from Coles and Woolworths. Only supported retailer pages in the current Add tab or extension-created task tabs are read. No account details or whole-page HTML are sent.
- `alarms`: resume active imports and schedule idle shared work. Shared polling stops on sign-out or opt-out.
- `storage`: cache the shared session and active work in `chrome.storage.session`. Passwords are never saved. The website cookie restores sign-in after Chrome restarts; unfinished work does not survive a restart.
- `cookies`: read and update only the MyShoppingList session cookie on localhost. Signing out in either the website or extension signs out both. Changing accounts clears old work and closes extension-owned tabs.
- `http://localhost/*`: Chrome host patterns do not restrict ports; the implementation sends API requests only to the fixed `http://localhost:5392` base. The website session bridge is limited to ports 3000 and 3001 and sends a session-change notification without credentials. No background browsing history collection or worker key. The packaged extractor is injected only for personal imports or reserved shared tasks.
- Submitted data: account email/password at sign-in; chosen list, quantity, canonical product URL, bounded product evidence and comparison search links when adding. Shared submissions also include the reserved task token and extension version. The server records the authenticated contributor ID, timestamps and validation outcome. No analytics or remote executable code.

## Tests

From the frontend: `node --test extensions/shopping-list/tests/extension.test.mjs`.

## Before Chrome Web Store publication

This local version is not ready for public installation. Set the production HTTPS API and website URL in `background.js`, update the cookie domain checks, website bridge origins and content-script matches, replace localhost host permission with the production host, update website links in `popup.html`, remove the local-test name and setup text, and configure the published extension ID on the server. Review the included blue basket icon (the Retailer Reader has an orange tag icon), add screenshots, a public privacy policy, support/contact URLs, a store description, and accurate privacy/permission disclosures. Verify production sign-in, expiry, imports, list selection and accessibility in an installed Chrome build. Package only runtime files (manifest, background, content.js, website-session.js, popup HTML/JS/CSS and icons), excluding tests and this README. Publish through the owner's Chrome Web Store developer account after review. Replace the website's installation instructions link with the published listing when available.

Chrome references: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab and https://developer.chrome.com/docs/extensions/develop/concepts/network-requests

## Administration

Sign in on the website and open /admin. The backend Admin:AccountIds setting controls access; it is never controlled by the browser. Administrators manually record paid status, block contributions, suspend/restore accounts and review the last 100 observations/actions. A reason is required for every change. Suspension revokes sessions; restoration requires signing in again. Paid status does not automatically grant access or change restrictions. Blocking contributions preserves shopping access and sends new Add requests to trusted processing. An extraction error is not proof of abuse. Historical observations remain attributable for review; no automatic abuse classification is performed.
