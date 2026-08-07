# LeetRepo

LeetRepo is a dependency-free Chrome/Chromium Manifest V3 extension that captures LeetCode attempts and commits accepted solutions to GitHub. It implements the supplied product wireframes as a real extension: onboarding, popup, in-page feedback, settings, solution library, attempt history, pattern analytics, spaced repetition, shareable stats, and atomic multi-file GitHub commits.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository.
4. Open LeetRepo and follow onboarding.

LeetRepo uses a fine-grained GitHub personal access token rather than bundling an OAuth client secret. Grant the token access only to the repository you want to sync and give it **Contents: read and write** permission. The token is kept in `chrome.storage.local` and is sent only to `api.github.com`.

## AI explanations with Groq

AI explanations are optional and disabled by default. To enable them, open **Settings → AI explanations**, add your own [Groq API key](https://console.groq.com/keys), choose a production model, and set a daily request limit.

- The Groq key is stored in `chrome.storage.local`, is not included in synced settings, and is never returned to extension pages after it is saved.
- Each request contains the problem title, difficulty, language, first detected description paragraph and example input/output, and up to 24,000 characters of solution code.
- Requests use Groq's OpenAI-compatible Chat Completions API with JSON output, a bounded completion size, and a 25-second timeout.
- The default cap is 20 attempted requests per UTC day, configurable from 1 to 100. Failed attempts count toward the limit to prevent repeated error loops.
- If Groq is unavailable, rejects the key, returns invalid output, or the limit is reached, the GitHub push continues with local rule-based interview and Mermaid replay templates.
- AI-generated READMEs include a reminder to verify the analysis.

The built-in request cap is a per-install guardrail, not an access-control or billing boundary. Anyone who controls their browser can modify extension storage or code. If LeetRepo later pays for requests with a shared service key, put that key behind an authenticated server-side proxy with a durable per-user rate limiter, payload limits, abuse monitoring, and provider-level spend caps. Never bundle a shared Groq key in the extension.

## How syncing works

- The content script detects the current LeetCode problem and accepted submission details.
- The first detected description paragraph and official example ground a self-contained solution replay with the goal, sample input, state changes, invariant, and sample output.
- Manual pushes come from either the in-page panel or toolbar popup.
- Auto-push is armed only by clicking LeetCode's Submit button and receiving a fresh Accepted result for that exact editor code.
- The service worker stores each solution in its language subfolder (for example, `0001-two-sum/python/solution.py`), keeps one generated README at the problem root, and advances the repository branch in a single commit.
- Before the branch moves, LeetRepo reads the proposed tree back from GitHub and aborts unless every existing repository file is still present and unchanged.
- Each problem README records the first synced solve time; later solution pushes refresh the metrics, notes, and generated analysis without resetting that timestamp.
- A local index powers the dashboard even when offline.

## Study and profile features

- The LeetCode panel records accepted and failed attempts, keeps personal notes, and can generate a 30-second interview refresher before a push.
- The dashboard separates the solution library, activity analytics, and study queue. Pattern and language coverage are derived from actual synced solutions.
- Spaced repetition resurfaces a solution 30 days after it is synced or reviewed, with a three-day snooze option.
- Shareable stats are rendered locally to an image and copied only after an explicit click.
- Existing LeetRepo-style folders can be backfilled from the selected GitHub repository into the local dashboard.
- Repository-profile generation is opt-in because it replaces the root `README.md`; when enabled, the refreshed profile is included in the same atomic commit as the solution.

See [PRIVACY.md](PRIVACY.md) for the data-handling disclosure.

## Development

No build step or dependencies are required. Run the unit tests with:

```bash
npm test
```

The extraction code intentionally uses several fallback selectors because LeetCode changes its DOM regularly.

## Repository structure

```text
assets/                 Extension icons
src/
  background/           Manifest V3 service worker
  content/              LeetCode page integration
  core/                 Submission and GitHub domain logic
  pages/                Popup, options, onboarding, and dashboard UIs
  shared/               UI helpers and shared styles
tests/                  Node unit tests for core logic
manifest.json           Chrome extension entry points and permissions
```
