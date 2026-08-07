# LeetRepo

LeetRepo is a dependency-free Chrome/Chromium Manifest V3 extension that captures accepted LeetCode submissions and commits them to GitHub. It implements the supplied product wireframes as a real extension: onboarding, popup, in-page panel, settings, dashboard, activity history, search, difficulty filters, and atomic multi-file GitHub commits.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository.
4. Open LeetRepo and follow onboarding.

LeetRepo uses a fine-grained GitHub personal access token rather than bundling an OAuth client secret. Grant the token access only to the repository you want to sync and give it **Contents: read and write** permission. The token is kept in `chrome.storage.local` and is sent only to `api.github.com`.

## How syncing works

- The content script detects the current LeetCode problem and accepted submission details.
- Manual pushes come from either the in-page panel or toolbar popup.
- Auto-push reacts to an accepted result appearing on the page.
- The service worker creates solution and README blobs, builds one Git tree, and advances the repository branch in a single commit.
- A local index powers the dashboard even when offline.

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
