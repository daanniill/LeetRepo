# LeetRepo Privacy Notice

Last updated: August 7, 2026

LeetRepo is a browser extension that reads accepted LeetCode submissions and commits files to a GitHub repository selected by the user. The extension does not operate a LeetRepo-owned backend and does not send analytics or advertising data.

## Data stored by the extension

- A repository-scoped GitHub personal access token is stored in local extension storage and is not synced.
- An optional Groq API key is stored in local extension storage and is not synced.
- Submission and attempt history, including problem metadata, solution code, result status, personal notes, review schedule, and resulting commit details, is stored locally to power the dashboard.
- Non-secret preferences, including the selected repository and AI configuration, may be stored through Chrome's synced extension storage when browser sync is enabled.

Local extension storage is protected by the browser profile but is not separately encrypted by LeetRepo. Users should protect access to their device and browser profile.

## Data sent to third parties

- When syncing a solution, LeetRepo sends the selected repository details, solution code, generated README, and Git commit data to GitHub using the user's token. GitHub's privacy terms apply.
- If repository-profile generation is enabled, LeetRepo also sends a generated root README containing aggregate solution statistics and recent problem metadata to GitHub. This setting is disabled by default.
- When the user backfills an existing repository, LeetRepo reads its Git tree from GitHub and stores matching solution-folder metadata locally. The backfill action does not change the repository.
- When AI explanations are enabled, LeetRepo sends the problem title, difficulty, programming language, and solution code to Groq using the user's key. Groq's privacy and data-processing terms apply.
- LeetCode page content is read locally by the extension. LeetRepo does not send it elsewhere unless required for the user-enabled GitHub sync or Groq explanation described above.
- Shareable stats images are rendered locally and are copied or handed to the browser share interface only after the user clicks the corresponding action.

## User choices and deletion

AI explanations are disabled by default. Users can disable them or remove the saved Groq key from Settings at any time. Disconnecting GitHub removes the locally saved GitHub token but preserves local submission history. Uninstalling the extension removes its local extension storage according to the browser's behavior; synced preferences may remain in the user's browser-sync account.

## Changes

Material changes to this notice should be reflected by updating the date above and the published extension listing. A production listing should link to a publicly hosted copy of this notice.
