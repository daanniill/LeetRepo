# LeetRepo production deployment

This is the launch checklist for the hosted API, public GitHub App, and Chrome Web Store extension. Complete the phases in order because the Chrome extension ID and GitHub callback configuration depend on the live API.

## Current release status

- The extension is Manifest V3 and contains no remotely executed code.
- GitHub access is limited to selected repositories with **Contents: read and write**; repository administration is explicitly rejected.
- OAuth state and one-time codes are hashed, credentials are encrypted with AES-256-GCM, explicit authorization uses PKCE, user tokens expire, and hosted sessions are revocable.
- The API is stateless across instances; PostgreSQL owns sessions, credentials, quotas, and one-time exchanges.
- The release package, listing copy, privacy answers, reviewer steps, screenshots, and artwork are prepared under `deployment/`.
- The configured production endpoint `https://leetrepo.onrender.com/healthz` returned `200` on retry during the August 11, 2026 audit, but an earlier 20-second timeout shows the current deployment is not yet a reliable launch baseline. Deploy this revision on an always-on instance and confirm `/livez` and `/readyz` before store submission.

## Phase 0: lock down publisher ownership

- [ ] Use a dedicated Google account for the Chrome Web Store publisher. Enable 2-Step Verification, save recovery codes offline, verify the contact email, and pay the one-time registration fee.
- [ ] Decide whether the publisher is a trader or non-trader and complete any identity/contact verification shown by the dashboard.
- [ ] Prefer a dedicated GitHub organization to own the repository and GitHub App. Require 2FA and keep at least two trusted owners so the app is not tied to one personal account.
- [ ] Enable GitHub private vulnerability reporting. `SECURITY.md` directs researchers there instead of a public issue.
- [ ] Create a Render workspace with billing alerts. Use least-privilege team roles and require 2FA for every operator.
- [ ] Store recovery codes and the production encryption key in a password manager controlled by the project owner. Keep production secrets in Render's secret manager—not in Git, GitHub Actions, issues, screenshots, or the extension. Keep any local `.env` ignored and owner-readable only.
- [ ] Revoke and replace the current Groq key before deployment; it must be treated as exposed by the launch audit. Put only the replacement key in Render, set a spend limit, and allow the `openai/gpt-oss-120b` production model.

## Phase 1: verify and package the exact release

Requirements: Node.js 24, npm, and `zip`.

```bash
npm ci
npm run release:check
shasum -a 256 dist/leetrepo-extension-2.0.0.zip
```

`release:check` runs all tests, builds a deterministic ZIP, verifies the manifest scope and API origin, rejects server/secrets/remote-code patterns from the package, and leaves the upload at `dist/leetrepo-extension-2.0.0.zip`.

- [ ] Run the command twice and confirm the SHA-256 is identical.
- [ ] Open `dist/extension/manifest.json` and confirm the name, description, version, API host, and LeetCode URL scope.
- [ ] If version `2.0.0` has ever been uploaded to this Chrome Web Store item, increment `version` in `manifest.json` and `package.json` before packaging. Chrome requires every uploaded version to increase.
- [ ] Confirm `git status` contains only intentional release changes.
- [ ] Push through a pull request and require the `CI / test-and-package` check before merge. The workflow also uploads the reviewed ZIP as a short-lived build artifact.

Optional container smoke check:

```bash
docker build -t leetrepo-api:2.0.0 .
```

## Phase 2: register the public GitHub App

In the owner account or organization, open **Settings → Developer settings → GitHub Apps → New GitHub App**. Use the exact values in `deployment/github-app/REGISTRATION.md`.

- [ ] Name: `LeetRepo` if available. Record the final slug.
- [ ] Homepage: `https://github.com/daanniill/LeetRepo` (or the final project website).
- [ ] Callback: `https://leetrepo.onrender.com/v1/auth/github/callback`. If Render assigns a different origin, update the callback, `src/config.js`, and `manifest.json` before packaging.
- [ ] Enable **Expire user authorization tokens**.
- [ ] Enable **Request user authorization (OAuth) during installation**.
- [ ] Disable Device Flow unless a separate reviewed client needs it.
- [ ] Leave Setup URL blank and Redirect on update disabled.
- [ ] Disable the webhook. No webhook events are needed for this release.
- [ ] Set installation availability to **Any account** so different users can install it.
- [ ] Set every permission to **No access** except **Repository permissions → Contents: Read and write**. Metadata read access is implicit.
- [ ] Confirm Repository administration, all organization permissions, and all user permissions are off.
- [ ] Upload `deployment/github-app/assets/github-app-logo-512.png` and use badge color `#2F8F8A`.
- [ ] Generate one client secret. Copy the slug, client ID, and secret directly into Render's secret fields; never into source control.

A public GitHub App can be installed from its public page and does not need GitHub Marketplace. Do not submit the prepared Marketplace draft yet: Marketplace adds pricing and purchase-webhook requirements that are not implemented or needed.

## Phase 3: deploy the API and PostgreSQL on Render

The checked-in `render.yaml` is the production baseline:

- always-on Starter web service, avoiding free-tier cold starts;
- paid PostgreSQL 18 with point-in-time backups;
- private internal database connection through managed PgBouncer;
- no public database IPs;
- migrations before each deploy;
- readiness health checks and graceful shutdown; and
- deploys only after GitHub checks pass.

In Render, choose **New → Blueprint**, connect this repository, review the estimated monthly cost, and apply `render.yaml`. Enter these prompted values:

| Variable | Production value |
| --- | --- |
| `GITHUB_APP_SLUG` | Final GitHub App slug |
| `GITHUB_APP_CLIENT_ID` | GitHub App client ID |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App client secret |
| `EXTENSION_REDIRECT_URIS` | Temporary test redirect initially; final store redirect in Phase 4 |
| `ALLOWED_EXTENSION_ORIGINS` | Temporary test origin initially; final store origin in Phase 4 |
| `GROQ_API_KEY` | Production Groq project key with spend/rate controls |

The configured Groq default is `openai/gpt-oss-120b`. The previous Llama defaults are scheduled to shut down for free and developer tiers on August 16, 2026, so do not restore them.

Render generates `TOKEN_ENCRYPTION_KEY`. Back it up once in the project password manager. Replacing it makes existing encrypted GitHub credentials unreadable; until key-versioned rotation is implemented, an emergency replacement requires invalidating stored credentials and asking all users to reconnect.

The Blueprint uses the internal database pool URL and sets `DATABASE_SSL=false` because traffic remains on Render's private network. If the API and database are ever separated across public networks, use a TLS connection string and a trusted CA instead.

After the deploy:

```bash
curl -fsS https://leetrepo.onrender.com/livez
curl -fsS https://leetrepo.onrender.com/readyz
```

Both must return `{"ok":true}`. `/livez` verifies the process; `/readyz` verifies PostgreSQL too. Also confirm:

- [ ] The deploy log says the schema is up to date and the API is listening.
- [ ] Request logs are structured JSON and do not include query strings, request bodies, tokens, solution code, or repository names.
- [ ] Responses include `X-Request-Id`, `X-Content-Type-Options`, `Referrer-Policy`, CSP, and production HSTS headers.
- [ ] The database has no external IP allowlist entries.
- [ ] A failed migration prevents the new release from replacing the working one.

## Phase 4: create the Chrome Web Store draft and bind its ID

1. Open the Chrome Web Store Developer Dashboard and click **Add new item**.
2. Upload the ZIP from `dist/`, but do not submit it yet.
3. Copy the permanent extension ID shown for the draft.
4. Update the Render service environment and redeploy:

```dotenv
EXTENSION_REDIRECT_URIS=https://EXTENSION_ID.chromiumapp.org/github
ALLOWED_EXTENSION_ORIGINS=chrome-extension://EXTENSION_ID
```

Comma-separated development IDs may be kept temporarily for testing, but remove IDs that are no longer controlled before launch.

5. Confirm the GitHub App callback is still the exact deployed API callback. The Chrome identity redirect belongs only in `EXTENSION_REDIRECT_URIS`, not in GitHub's callback field.
6. Recheck `/readyz` after the environment update.

## Phase 5: complete the store listing

Use `deployment/chrome-web-store/LISTING.md` as paste-ready copy.

- [ ] Store listing: description, category, language, homepage, support URL, regions, and free pricing.
- [ ] Upload the 128px icon, five numbered 1280×800 screenshots, 440×280 small promo tile, and optional 1400×560 marquee tile from `deployment/chrome-web-store/assets/`.
- [ ] Privacy: paste the single-purpose statement and every permission/host justification exactly as prepared.
- [ ] Remote code: select **No**. All executable JS/CSS is packaged; GitHub and API responses are data.
- [ ] Data disclosure: select personally identifiable information, authentication information, web history, user activity, and website content. Local-only data still counts.
- [ ] Certify every Limited Use statement.
- [ ] Privacy policy: use the public `PRIVACY.md` URL and verify it works while signed out.
- [ ] Test instructions: paste the prepared reviewer walkthrough. No developer-provided password or paid account is required.
- [ ] Distribution: public, free, supported regions, not mature content.
- [ ] Use deferred publishing so approval does not launch before production verification is complete.

## Phase 6: production end-to-end test

Use a disposable GitHub repository and a test GitHub/LeetCode account. Test the store-delivered build when available, not only an unpacked extension.

- [ ] New user installs the GitHub App on exactly one repository.
- [ ] OAuth returns to `https://EXTENSION_ID.chromiumapp.org/github` and onboarding lists only selected repositories.
- [ ] AI remains off by default and basic README sync works without Groq.
- [ ] A fresh Accepted Two Sum submission creates one atomic commit containing the solution and README.
- [ ] A second language updates the same problem folder without deleting unrelated files.
- [ ] Removing repository access in GitHub makes that repository unavailable after reconnecting.
- [ ] Access-token refresh works after the short-lived token is near expiry.
- [ ] Sign out revokes only the current LeetRepo session and preserves local history.
- [ ] Delete account removes hosted credentials, sessions, quotas, and extension storage, revokes GitHub authorization, and does not alter or delete the repository.
- [ ] `/readyz` stays healthy and logs contain no sensitive request content throughout the test.
- [ ] Chrome popup, onboarding, dashboard, settings, privacy, and terms pages render without console errors.

When every check passes, submit for review. After approval, perform the same smoke test with the staged item, then publish within Chrome's staged-submission window.

## Capacity, stability, and cost plan

The first bottleneck is expected to be optional AI, not GitHub sync: most GitHub calls go directly from each extension under that user's GitHub rate limit. The hosted API mainly performs OAuth, token refresh, small database queries, and consented AI requests.

Launch baseline:

- one always-on Starter API instance;
- Basic-256MB Postgres with PgBouncer and a 10-connection application pool;
- transactional daily/monthly per-user AI quotas and a 25-request global per-minute guardrail; and
- maximum 64KB API bodies, while solution code is further bounded to 24,000 characters for AI.

Scale deliberately:

- Move the web service to Standard or add a second instance when sustained CPU exceeds 70%, memory exceeds 75%, non-provider p95 latency exceeds 500ms, or requests queue during normal peaks.
- On a Pro Render workspace, autoscale with at least two instances when uptime is more important than minimum cost. Keep `instances × DATABASE_POOL_MAX` within the database/PgBouncer client capacity.
- Increase AI concurrency only after setting a provider budget alert and verifying failure rate, latency, and cost per successful explanation. A queue is appropriate if requests exceed the provider's stable synchronous capacity.
- Upgrade PostgreSQL memory/storage when connection wait time, CPU, or storage exceed 70%. Enable high availability before promising a 99.9% service target; test a manual failover and client reconnection.
- Keep direct database access disabled. If operational access is needed, temporarily allow only a fixed VPN/office IP and remove it afterward.

Operational alerts:

- [ ] `/readyz` failure for two consecutive checks.
- [ ] API 5xx rate over 1% for five minutes.
- [ ] p95 latency over one second, tracked separately for GitHub/Groq provider errors.
- [ ] PostgreSQL CPU, memory, storage, connections, and failed pre-deploy migration.
- [ ] AI quota saturation, Groq 429/5xx rate, and monthly spend threshold.
- [ ] GitHub token exchange, refresh, and revocation failures.
- [ ] Chrome Web Store rejection, takedown, and developer-account emails.

Run a quarterly restore drill from a paid PostgreSQL point-in-time backup. Review dependencies monthly through Dependabot, patch high/critical advisories promptly, rotate the GitHub client secret and Groq key with overlap, and review GitHub App permissions after every feature change.

For abuse beyond the current quotas, put a custom API domain behind a managed WAF/rate limiter and cap `/v1/auth/*` per source before adding in-process memory limits. A memory-only limiter is not reliable once the API has multiple instances. Changing the API domain requires a new extension version and host-permission review.

## Release and rollback

- [ ] Tag the exact commit used to build the submitted ZIP.
- [ ] Save the ZIP SHA-256, GitHub Actions run, Render deploy ID, database migration result, and Chrome version in the release record.
- [ ] Keep the previous API image/deploy available for rollback. Database changes must remain backward compatible until the older API can no longer be restored.
- [ ] Use Chrome's existing item for updates; never create a new store item just to ship a fix, because that changes the extension ID and OAuth redirect.
- [ ] For a serious extension regression, pause/defer publication or roll back through the Chrome Web Store dashboard while keeping the API compatible with both releases.
- [ ] For a credential incident, revoke the affected GitHub/Groq secret, redeploy, invalidate sessions/credentials if needed, document scope, and notify affected users through the store listing/repository according to severity.

## Official references

- [Chrome: register a developer account](https://developer.chrome.com/docs/webstore/register/)
- [Chrome: prepare an extension](https://developer.chrome.com/docs/webstore/prepare)
- [Chrome: publish and use deferred publishing](https://developer.chrome.com/docs/webstore/publish/)
- [Chrome: privacy fields and permission justifications](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Chrome Web Store user data requirements](https://developer.chrome.com/docs/webstore/user_data)
- [GitHub: register a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [GitHub: generate expiring user access tokens and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub: REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render PostgreSQL connection pooling](https://render.com/docs/postgresql-connection-pooling)
- [Render PostgreSQL backups](https://render.com/docs/postgresql-backups)
- [Render service scaling](https://render.com/docs/scaling)
- [Groq production models](https://console.groq.com/docs/models)
- [Groq model deprecations](https://console.groq.com/docs/deprecations)
