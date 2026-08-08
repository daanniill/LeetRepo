# LeetRepo Lite Privacy Notice

Last updated: August 7, 2026

LeetRepo Lite is the lite, local-run edition of LeetRepo: a browser extension that reads accepted LeetCode submissions and commits files to a GitHub repository selected by the user. It has no account and no LeetRepo-owned backend, does not store user info on any server, and does not send analytics or advertising data.

## Data stored by the extension

- A one-time GitHub device code is stored temporarily during sign-in. The resulting GitHub OAuth access token is stored in local extension storage and is not synced. LeetRepo Lite requests the `repo` scope to support commits to public and private repositories.
- An optional Groq API key is stored in local extension storage and is not synced.
- Submission and attempt history, including problem metadata, the first detected description paragraph and example input/output, solution code, result status, personal notes, review schedule, and resulting commit details, is stored locally to power the dashboard.
- Non-secret preferences, including the selected repository and AI configuration, may be stored through Chrome's synced extension storage when browser sync is enabled.

Local extension storage is protected by the browser profile but is not separately encrypted by LeetRepo Lite. Users should protect access to their device and browser profile. LeetRepo Lite has no server of its own, so none of this data is stored anywhere except your local browser profile (and, if Chrome sync is enabled, your own browser-sync account).

## Data sent to third parties

- When signing in, LeetRepo Lite exchanges a one-time device code directly with GitHub. When syncing a solution, it sends the selected repository details, solution code, generated README, and Git commit data to GitHub using the resulting OAuth access token. GitHub's privacy terms apply.
- If repository-profile generation is enabled, LeetRepo Lite also sends a generated root README containing aggregate solution statistics and recent problem metadata to GitHub. This setting is disabled by default.
- When the user backfills an existing repository, LeetRepo Lite reads its Git tree from GitHub and stores matching solution-folder metadata locally. The backfill action does not change the repository.
- When AI explanations are enabled, LeetRepo Lite sends the problem title, difficulty, programming language, first detected description paragraph and example input/output, and solution code to Groq using the user's key. Groq's privacy and data-processing terms apply.
- LeetCode page content is read locally by the extension. LeetRepo Lite does not send it elsewhere unless required for the user-enabled GitHub sync or Groq explanation described above.
- Shareable stats images are rendered locally and are copied or handed to the browser share interface only after the user clicks the corresponding action.

## User choices and deletion

AI explanations are disabled by default. Users can disable them or remove the saved Groq key from Settings at any time. Disconnecting GitHub removes the locally saved GitHub authorization but preserves local submission history. Uninstalling the extension removes its local extension storage according to the browser's behavior; synced preferences may remain in the user's browser-sync account.

## Changes

Material changes to this notice should be reflected by updating the date above and the published extension listing. A production listing should link to a publicly hosted copy of this notice. If a future non-lite edition of LeetRepo adds an account or a backend, that edition will be covered by its own privacy notice.
