# LeetRepo Privacy Notice

Last updated: August 7, 2026

LeetRepo is a browser extension and hosted service that reads accepted LeetCode submissions, commits user-selected content to a GitHub repository, and optionally generates AI study explanations. LeetRepo does not sell user data, serve advertising, or use browsing activity for advertising.

## Data stored on your device

- Submission and attempt history, including problem metadata, detected problem context and examples, solution code, result status, personal notes, review schedule, and resulting commit details, is stored locally to power the dashboard.
- A short-lived GitHub App user access token and an opaque LeetRepo session token are stored in local extension storage and are not synced.
- Non-secret preferences, including the selected repository and AI consent setting, may be stored through Chrome's synced extension storage when browser sync is enabled.

Local extension storage is protected by the browser profile but is not separately encrypted by LeetRepo. Protect access to your device and browser profile.

## Data stored by the hosted service

The LeetRepo service stores:

- your immutable GitHub numeric user ID, current GitHub username, and avatar URL;
- an encrypted GitHub refresh token and encrypted short-lived access token;
- a cryptographic hash of your LeetRepo session token, never the session token itself;
- aggregate daily and monthly AI request and token counts; and
- random AI request identifiers and their success or failure status for replay and quota protection.

OAuth state expires after 10 minutes, one-time extension exchange codes expire after 5 minutes, and LeetRepo sessions expire after 30 days. Expired temporary records are removed by scheduled cleanup. AI request identifiers are removed after 31 days. Accounts with no live session are removed after 31 days of inactivity. Aggregate usage and credentials are otherwise kept until account deletion.

## Data sent to GitHub

During sign-in, the hosted service exchanges GitHub's authorization code and verifies the repositories available through your GitHub App installations. The GitHub App requests only repository **Contents: read and write** access for repositories selected during installation.

When syncing, the extension sends repository details, solution code, generated README content, and Git commit data directly to GitHub using the short-lived user access token. If repository-profile generation is enabled, LeetRepo may update the selected repository's root `README.md`. When backfilling, LeetRepo reads the selected repository's Git tree and stores matching solution metadata locally.

GitHub's privacy terms apply to data sent to GitHub.

## Optional AI processing

AI explanations are disabled by default and require affirmative consent in Settings. When enabled, the extension sends the problem title, difficulty, programming language, detected problem context and example input/output, and up to 24,000 characters of solution code to the LeetRepo service. The service sends that material to Groq to generate the requested explanation.

AI request bodies and generated explanations are processed in memory and are not stored in the LeetRepo application database or ordinary application logs. The hosting provider may retain limited access and security logs, and Groq processes requests under its own privacy and data-processing terms. LeetRepo logs only the API route, response status, and request duration; it does not log request bodies, OAuth query values, access tokens, or session tokens.

## Security

LeetRepo requires HTTPS in production. GitHub credentials are encrypted at rest using AES-256-GCM. LeetRepo session tokens and one-time authorization values are stored as SHA-256 hashes. Provider credentials, the GitHub client secret, and the encryption key remain in the server environment and are not included in the extension package.

No internet-connected service can guarantee absolute security. Revoke the GitHub App installation and contact the project if you believe your authorization has been compromised.

## Your choices and deletion

- You can keep hosted AI disabled and continue using local rule-based study templates.
- Turning off AI stops future AI transmissions but preserves local history.
- **Disconnect GitHub** deletes your hosted LeetRepo account, encrypted GitHub credentials, sessions, and aggregate AI usage. It also removes local authorization while preserving local submission history.
- Uninstalling the extension removes local extension storage according to browser behavior. Synced preferences may remain in your browser-sync account, and uninstalling alone does not notify the hosted service. Disconnect before uninstalling if you want immediate hosted-data deletion; otherwise inactive hosted account data is removed as described above.
- You can also revoke or narrow the GitHub App installation from GitHub settings.

## Chrome Web Store Limited Use disclosure

LeetRepo uses data obtained through extension permissions only to provide and improve its user-facing GitHub sync, local study dashboard, and optional AI explanation features. LeetRepo does not use or transfer this data for personalized advertising, creditworthiness, lending, or sale to data brokers. Humans do not read solution code or other user content except with the user's specific consent for support, when necessary for security, when required by law, or in aggregated and anonymized form for internal operations.

## Changes and contact

Material changes will update the date above and the Chrome Web Store disclosures. Questions or deletion problems may be submitted through the [LeetRepo issue tracker](https://github.com/daanniill/LeetRepo/issues). Do not include access tokens, API keys, private solution code, or other secrets in a public issue.
