# LeetRepo Lite

<p align="center">
  <strong>Solve it. Keep it.</strong><br>
  Turn every Accepted LeetCode submission into an organized GitHub archive and a study system built from your own solutions.
</p>

![Every accepted LeetCode solution documented and pushed to GitHub](.github/readme-assets/hero.png)

LeetRepo Lite is a local-first Chrome/Chromium extension that saves Accepted LeetCode solutions to GitHub, adds optional AI-generated interview notes using your own provider key, and turns your solve history into a searchable dashboard and study queue. It has no LeetRepo account, database, or hosted backend.

**Automatic GitHub commits · Multi-language solutions · Attempt history · Pattern analytics · Spaced repetition**

## What is included

- **Safe GitHub sync.** Push manually or automatically without copying and pasting code. Every update is verified before the repository branch moves.
- **Organized solution history.** Keep multiple languages under one problem folder while preserving the original solved time.
- **Richer READMEs.** Include problem context, examples, solve metadata, notes, and an optional AI walkthrough.
- **Search and analytics.** Filter by problem, language, difficulty, pattern, or notes and inspect attempts, streaks, and activity.
- **Adaptive review.** Work through a due/upcoming study queue and choose a review interval in days, weeks, or months.
- **Bring your own AI.** Use Groq, OpenAI, OpenRouter, or a custom OpenAI-compatible chat-completions endpoint.

## How it works

1. **Solve a problem on LeetCode.** LeetRepo Lite detects the problem, language, code, result, and available performance metrics.
2. **Confirm the solution.** Push from the page panel or toolbar popup, or enable automatic pushes for newly Accepted submissions.
3. **Sync one clean commit.** The extension commits the solution and tagged README directly to the selected GitHub repository with your token, without changing unrelated files.
4. **Review it later.** The dashboard rebuilds your library, notes, and study state from GitHub READMEs; compact attempt events remain on this device.

A synced problem looks like this:

```text
0001-two-sum/
├── README.md
├── python/
│   └── solution.py
└── cpp/
    └── solution.cpp
```

## Dashboard

The generated README includes a hidden, versioned LeetRepo data tag containing the problem, solution variants, explanations, notes, and study state needed by the dashboard and repository backfill. Its rendered Markdown stays human-readable. Solving the same problem in another language updates its existing folder while preserving the original solved time.

![LeetRepo Lite solution library with synced problems and AI overviews](.github/readme-assets/solution-library.png)

### Problems

Search and filter the solution library, inspect every language variant, edit GitHub-backed notes, and jump back to LeetCode or GitHub.

### Activity

Track repository growth, solve activity, pattern coverage, language usage, and failed and Accepted attempts. Progress cards are rendered and shared locally.

![LeetRepo Lite solve activity, pattern coverage, and language breakdown](.github/readme-assets/activity.png)

### Study

Review due and upcoming problems, recall a solution before revealing its refresher, and rate each review so difficult problems return sooner.

![LeetRepo Lite spaced-repetition study queue](.github/readme-assets/study.png)

## Install locally

Prerequisites:

- Chrome or another Chromium-based browser
- A GitHub account and a repository for solutions
- A GitHub personal access token
- Optional: an API key for an OpenAI-compatible AI provider

Installation:

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository root.
5. Open LeetRepo Lite and complete the three-step onboarding.

There is no build step and no local server to start.

## GitHub token setup

The onboarding page accepts either:

- a fine-grained personal access token with access to the destination repositories, **Metadata: read**, and **Contents: read and write**; or
- a classic personal access token with the `repo` scope when private-repository access is needed.

Create a fine-grained token from [GitHub → Settings → Developer settings → Personal access tokens](https://github.com/settings/personal-access-tokens/new). LeetRepo Lite verifies the token with GitHub, lists only repositories it can access, and stores it in `chrome.storage.local`. The token is not placed in source files or synced through Chrome.

Use the narrowest repository selection and shortest practical expiration. If the token is revoked or expires, paste a replacement in Settings.

## Optional AI setup

AI-generated READMEs are disabled by default. Onboarding and Settings support:

- Groq;
- OpenAI;
- OpenRouter; and
- a custom HTTPS or localhost OpenAI-compatible `/chat/completions` endpoint and model ID.

When AI is enabled, LeetRepo Lite sends the problem title, difficulty, language, detected problem context and example, and up to 24,000 characters of solution code directly to the configured endpoint. The provider key is stored only in `chrome.storage.local` and is never returned to extension pages after saving.

The per-install daily request limit is configurable from 1 to 100. Failed attempts count toward the limit. Provider failures never block GitHub sync; the extension falls back to the local review template. AI output is marked for verification.

Custom remote endpoints request an additional Chrome host permission when saved. This permission is limited to the selected endpoint origin and can be removed from the browser's extension settings.

## Privacy and safety

- GitHub and AI credentials stay in local extension storage and are sent only to the configured services.
- Credentials, settings, AI usage, and compact attempt events stay in the browser profile; solution history, notes, and study schedules live in tagged GitHub READMEs.
- Repository-profile generation is opt-in because it replaces the destination repository's root `README.md`.
- Before moving a branch, LeetRepo Lite reads the proposed tree back and stops unless existing files are preserved.
- Repository refresh is read-only and rebuilds the dashboard from tagged problem READMEs and solution folders.
- **Clear all local data** removes credentials, preferences, history, notes, and review state without changing GitHub repositories.

Read the [Privacy Notice](PRIVACY.md), [Terms and Conditions](TERMS.md), and [Security Policy](SECURITY.md) for more detail.

## Development

Run the tests:

```bash
npm test
```

Create and verify a Chrome Web Store package:

```bash
npm run release:check
```

The archive is written to `dist/`. LeetCode changes its DOM regularly, so the extraction code intentionally uses several fallback selectors.

### Repository structure

```text
assets/                  Extension icons
scripts/                 Release packaging and verification helpers
src/
  background/            Manifest V3 service worker
  content/               LeetCode page integration
  core/                  Submission, GitHub, AI, and study logic
  pages/                 Popup, settings, onboarding, legal, and dashboard UIs
  shared/                Shared UI helpers and styles
tests/                   Node.js tests
manifest.json            Extension entry point and permissions
```
## License

LeetRepo Lite is available under the [MIT License](LICENSE).
