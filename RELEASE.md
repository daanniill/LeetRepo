# LeetRepo release checklist

## 1. Production service

- Provision PostgreSQL with backups and verified TLS.
- Deploy the `Dockerfile` behind HTTPS at the origin configured in `src/config.js` and `manifest.json`.
- Set every variable in `.env.example` through the hosting platform's secret manager. Never upload `.env`.
- Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32` and store a recoverable backup in the secret manager. Losing it invalidates every stored GitHub credential.
- Set a provider-level monthly spend cap and alerts below the maximum acceptable loss.
- Run `npm run db:migrate` as a release job, then deploy the API.
- Verify `GET /healthz` returns `{"ok":true}` without authentication.

## 2. GitHub App

Create the app under a project organization, not a personal maintainer account.

- Public app: enabled.
- Homepage URL: the public LeetRepo product page.
- Callback URL: `https://api.leetrepo.app/v1/auth/github/callback`.
- Expire user authorization tokens: enabled.
- Request user authorization during installation: enabled.
- Device flow: disabled.
- Webhook: inactive.
- Repository permissions: **Contents — Read and write** only. GitHub adds Metadata read access.
- Organization and account permissions: none.

Put the app slug, client ID, and client secret in the production service environment. Do not put them in the extension, except that GitHub exposes the app slug through the hosted start endpoint.

## 3. Chrome identity and package

1. Create the Chrome Web Store item as a draft so it has a stable extension ID.
2. Load the production package and evaluate `chrome.identity.getRedirectURL("github")` from the extension service worker.
3. Add that exact HTTPS URL to `EXTENSION_REDIRECT_URIS` in the service environment.
4. Add `chrome-extension://EXTENSION_ID` to `ALLOWED_EXTENSION_ORIGINS`.
5. Confirm the API origin in `src/config.js` exactly matches the host permission in `manifest.json`.
6. Run `npm test` and `npm run package:extension`.
7. Upload the ZIP from `dist/`.

## 4. Chrome Web Store disclosures

Host `PRIVACY.md` at a stable public HTTPS URL and use that URL in the Developer Dashboard. The privacy declaration and listing should disclose:

- authentication information;
- website content and user-generated content read from LeetCode;
- local storage of submission history and preferences;
- GitHub repository reads and writes;
- optional transmission of problem context and solution code to LeetRepo and Groq for AI explanations;
- server-side account identifiers, encrypted GitHub credentials, sessions, and aggregate quota usage; and
- the Limited Use statement in the privacy notice.

Permission justifications:

- `storage`: local study history, credentials, and preferences.
- `activeTab`: identify the current LeetCode problem only when the user opens the extension popup.
- `clipboardWrite`: copy user-requested share cards and content.
- `identity`: complete the GitHub App web authorization flow.
- `https://api.github.com/*`: list selected installations and commit solutions.
- `https://api.leetrepo.app/*`: authentication, token refresh, AI explanations, usage, and deletion.

## 5. Release verification

Test with separate GitHub accounts and both public and private selected repositories:

- install on exactly one repository and confirm no other repository appears;
- initialize an empty repository and push an Accepted solution;
- update an existing solution without deleting unrelated files;
- let a GitHub token expire or force its expiry in the database and confirm transparent refresh;
- revoke the GitHub App and confirm LeetRepo asks the user to reconnect;
- reach daily and monthly AI limits and confirm the local template still allows the GitHub push;
- disconnect and confirm the hosted user, credentials, sessions, and usage rows are deleted; and
- verify server logs contain paths and statuses, but no query strings, request bodies, source code, tokens, or OAuth codes.

Start with a limited tester group. Monitor authentication completion, GitHub 401/403/404 rates, AI success and fallback rates, provider 429s, token usage per explanation, and account deletion failures before moving the listing to public visibility.
