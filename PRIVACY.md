# LeetRepo Lite Privacy Notice

Last updated: August 11, 2026

LeetRepo Lite is a local-first browser extension that reads LeetCode submission details, commits user-selected content to GitHub, and optionally requests AI study explanations. It has no LeetRepo account, hosted backend, analytics service, or advertising system.

## Data stored on your device

LeetRepo Lite stores the following in your browser profile:

- a GitHub personal access token and basic GitHub profile details;
- an optional AI provider API key;
- the selected AI provider, endpoint, model, and local request counter;
- repository and extension preferences; and
- submission and attempt history, including problem metadata, detected context and examples, solution code, result status, personal notes, review schedule, and commit details.

Credentials use `chrome.storage.local` and are not synced. Non-secret settings may use Chrome's synced extension storage when browser sync is enabled. Browser extension storage is protected by the browser profile but is not separately encrypted by LeetRepo Lite.

## Data sent to GitHub

When connecting, LeetRepo Lite sends the supplied token to GitHub's API to verify the account and list accessible repositories. When syncing, it sends the selected repository details, solution code, generated README, and Git commit data directly to GitHub.

If repository-profile generation is enabled, the extension may update the selected repository's root `README.md`. Repository backfill reads the selected repository tree and recent commit metadata but does not change the repository. GitHub's terms and privacy policy apply.

## Optional AI processing

AI processing is disabled by default. When enabled, LeetRepo Lite sends the problem title, difficulty, language, detected problem context and example, and up to 24,000 characters of solution code directly to the AI chat-completions endpoint selected by the user. The selected provider's terms, privacy policy, retention rules, and charges apply.

LeetRepo Lite does not proxy, retain, or inspect these requests on a LeetRepo server. A local daily counter helps prevent accidental use but is not an access-control or billing boundary. Generated content may be inaccurate and should be reviewed.

## LeetCode and local sharing

LeetCode page content is read locally. It is sent elsewhere only when required for a user-initiated or configured GitHub sync or optional AI request. Shareable progress images are rendered locally and are copied or handed to the browser share interface only after an explicit action.

## Permissions

LeetRepo Lite requests storage and clipboard access, access to LeetCode problem pages, and host access to GitHub and the built-in AI provider endpoints. A custom remote AI endpoint requires an additional origin-specific permission approved by the user. These permissions are used only for the extension features described above.

## Retention and deletion

Local data remains until the user removes it, clears browser data, removes the extension, or selects **Clear all local data** in Settings. Clearing local data removes saved tokens, settings, history, notes, and study state but does not delete or modify existing GitHub repositories or provider-side records.

Users can revoke tokens independently through GitHub or their AI provider. Removing an optional endpoint permission prevents future requests to that origin but does not remove the saved provider configuration.

## Limited-use disclosure

LeetRepo Lite uses data obtained through extension permissions only to provide its GitHub sync, local dashboard, study, and optional AI features. It does not sell data, use it for advertising, determine creditworthiness, or transfer it to data brokers. No LeetRepo operator receives solution code or credentials through a LeetRepo service.

## Changes and contact

Material changes will update the date above. Questions or security reports may be submitted through the [LeetRepo issue tracker](https://github.com/daanniill/LeetRepo/issues). Never include access tokens, API keys, private solution code, or other secrets in a public issue.
