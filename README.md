# LeetRepo

LeetRepo is a dependency-free Chrome/Chromium Manifest V3 extension that captures accepted LeetCode submissions and commits them to GitHub. It implements the supplied product wireframes as a real extension: onboarding, popup, in-page panel, settings, dashboard, activity history, search, difficulty filters, and atomic multi-file GitHub commits.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository.
4. Open LeetRepo and follow onboarding.

LeetRepo uses a fine-grained GitHub personal access token rather than bundling an OAuth client secret. Grant the token access only to the repository you want to sync and give it **Contents: read and write** permission. The token is kept in `chrome.storage.local` and is sent only to `api.github.com`.

## AI explanations with Groq

AI explanations are optional and disabled by default. To enable them, open **Settings → AI explanations**, add your own [Groq API key](https://console.groq.com/keys), choose a production model, and set a daily request limit.

- The Groq key is stored in `chrome.storage.local`, is not included in synced settings, and is never returned to extension pages after it is saved.
- Each request contains the problem title, difficulty, language, and up to 24,000 characters of solution code.
- Requests use Groq's OpenAI-compatible Chat Completions API with JSON output, a bounded completion size, and a 25-second timeout.
- The default cap is 20 attempted requests per UTC day, configurable from 1 to 100. Failed attempts count toward the limit to prevent repeated error loops.
- If Groq is unavailable, rejects the key, returns invalid output, or the limit is reached, the GitHub push continues with the local rule-based interview template.
- AI-generated READMEs include a reminder to verify the analysis.

The built-in request cap is a per-install guardrail, not an access-control or billing boundary. Anyone who controls their browser can modify extension storage or code. If LeetRepo later pays for requests with a shared service key, put that key behind an authenticated server-side proxy with a durable per-user rate limiter, payload limits, abuse monitoring, and provider-level spend caps. Never bundle a shared Groq key in the extension.

## How syncing works

- The content script detects the current LeetCode problem and accepted submission details.
- Manual pushes come from either the in-page panel or toolbar popup.
- Auto-push reacts to an accepted result appearing on the page.
- The service worker creates solution and README blobs, builds one Git tree, and advances the repository branch in a single commit.
- A local index powers the dashboard even when offline.

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
