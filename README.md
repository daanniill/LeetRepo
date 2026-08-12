# LeetRepo

<p align="center">
  <strong>Solve it. Keep it.</strong><br>
  Turn every Accepted LeetCode submission into a clean GitHub archive and a study system built from your own solutions.
</p>

LeetRepo is a dependency-free Chrome/Chromium Manifest V3 extension. It captures the path to Accepted, commits the final solution to GitHub, generates a problem README, and keeps the result ready for interview review.

**Automatic GitHub commits · Clean problem READMEs · Attempt history · Pattern analytics · Spaced repetition**

## Why LeetRepo

LeetRepo turns accepted solutions into a GitHub-backed library you can learn from and revisit.

- **Save automatically.** Skip the copy-paste after every solve.
- **Stay organized.** Keep solutions and problem notes together.
- **Learn from attempts.** Preserve the path to the final answer.
- **Review smarter.** Track patterns, study gaps, and spaced repetition.

## How it works

1. **Solve on LeetCode.** LeetRepo reads the current problem, editor language, code, submission result, and available performance metrics.
2. **Confirm the solution.** Push from the in-page panel or toolbar popup, or let a newly Accepted submission trigger auto-push.
3. **Commit atomically.** LeetRepo creates or updates the problem folder and advances the repository branch in one multi-file commit.
4. **Review later.** The local dashboard turns synced solutions into a searchable library, activity view, and study queue.

A synced problem follows this shape:

```text
0001-two-sum/
├── README.md
└── python/
    └── solution.py
```

The generated README can include solve metadata, the captured problem context, complexity, personal notes, interview prompts, and a replay of the approach. Pushing another language updates the same problem folder without resetting the original solved time.

## Built for the next interview

The dashboard separates three jobs that usually get mixed together:

### Problems

Search and filter the solution library, inspect a problem's interview overview, and jump back to LeetCode or the GitHub commit.

### Activity

See repository growth, solve activity, pattern coverage, language breakdown, the full sequence of failed and accepted attempts, and create a shareable progress image locally.

### Study

Work through a due and upcoming review queue, recall each solution before revealing its refresher, and filter coverage by pattern or difficulty. Choose a resurface interval in days, weeks, or months; successful recalls use that interval while harder reviews return sooner.

## Install locally

The extension has no build step. Hosted authentication and AI use the Node/PostgreSQL service in `server/`.

1. Configure and run the hosted service using the instructions below.
2. Set `LEETREPO_API_BASE_URL` in [`src/config.js`](src/config.js) and the matching API origin in [`manifest.json`](manifest.json).
3. Add the exact value returned by `chrome.identity.getRedirectURL("github")` to `EXTENSION_REDIRECT_URIS` on the server.
4. Use an HTTPS development URL; GitHub and Chrome identity callbacks should not use a plain local HTTP URL.
5. Open `chrome://extensions` in Chrome or Chromium.
6. Enable **Developer mode**.
7. Choose **Load unpacked** and select this repository.
8. Open LeetRepo and complete onboarding.

## Configure GitHub sign-in

LeetRepo uses a public GitHub App and a hosted OAuth callback. Users click one sign-in button, select the repositories the app may access, and never create or paste a personal access token.

Create a GitHub App under an organization you control with these settings:

- Make the app public and enable **Request user authorization (OAuth) during installation**.
- Keep expiring user authorization tokens enabled.
- Set the callback URL to `https://leetrepo.onrender.com/v1/auth/github/callback`, replacing the origin if needed.
- Grant only **Repository permissions → Contents: Read and write**. Metadata read access is included by GitHub.
- Disable the webhook; LeetRepo does not subscribe to events.
- Do not grant Administration permission. LeetRepo rejects installations that report this permission, and without it the app cannot call GitHub's repository-deletion endpoint. Users create the destination repository on GitHub before installing LeetRepo.

Set the app slug, client ID, and client secret in the server environment. The client secret and refresh tokens must never be added to extension code. The backend stores the refresh token encrypted; the extension receives a short-lived user access token and sends Git commit requests directly to GitHub.

## Hosted service

Requirements: Node.js 24 or newer and PostgreSQL.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm start
```

Provide the environment variables described in [`.env.example`](.env.example). In production, terminate TLS at the hosting platform, use a managed PostgreSQL database with verified TLS, keep `TOKEN_ENCRYPTION_KEY` and provider keys in its secret manager, and run `npm run db:migrate` before starting a new release.

The API provides:

- GitHub App OAuth state validation and one-time extension code exchange.
- Encrypted GitHub refresh-token storage and short-lived token refresh.
- Hashed, revocable 30-day LeetRepo sessions.
- A structured AI endpoint that owns the model and prompt; it is not an arbitrary LLM proxy.
- Atomic per-user daily/monthly quotas plus a global per-minute guardrail.
- Current-session revocation through **Sign out**, without removing the GitHub App installation.
- Comprehensive account deletion that clears extension storage, revokes GitHub authorization, and deletes hosted data without changing repositories. The GitHub App installation remains until the user removes it in GitHub settings.

## Optional AI-generated READMEs

AI-generated READMEs are optional and disabled by default. Users can opt in during onboarding, in Settings, or from the LeetCode page panel. Leaving AI off produces a basic README with captured LeetCode metadata and stats, without an interview walkthrough or Mermaid diagram.

When enabled:

- The extension sends the problem title, difficulty, language, detected context and example, and up to 24,000 characters of solution code to the LeetRepo API.
- The API constructs the prompt, calls the configured Groq model, validates bounded JSON output, and returns only the generated review and usage counters.
- The free tier allows 3 attempted requests per UTC day and 30 per UTC month. Limits are enforced transactionally by GitHub's immutable numeric user ID.
- Request bodies are not written to the application database or ordinary application logs.
- If the service or provider is unavailable, returns invalid output, or reaches a limit, the GitHub push continues with the basic stats-only README.
- Once a daily or monthly tier limit is reached, AI actions are disabled. Turning AI off keeps the same workflows available with local rule-based feedback and stats-only READMEs.
- AI-generated READMEs include a reminder to verify the analysis.

## Data handling and safety

- GitHub App refresh tokens are encrypted by the hosted service. Short-lived GitHub access tokens and opaque LeetRepo session tokens stay in local extension storage and are not synced.
- The GitHub App has Contents read/write access but no Repository administration permission, so it cannot delete a GitHub repository.
- Shareable stats are rendered locally and copied or shared only after an explicit click.
- Repository-profile generation is opt-in because it replaces the destination repository's root `README.md`.
- Before moving a GitHub branch, LeetRepo reads the proposed tree back and aborts unless every existing repository file is still present and unchanged.
- Existing LeetRepo-style folders can be imported from the selected repository to rebuild the local dashboard index.

## Privacy, terms, and license

- **Privacy:** Read the [LeetRepo Privacy Notice](PRIVACY.md) before installing. It explains what data stays on your device, what is sent to GitHub or Groq, how credentials are stored, and how to remove saved data.
- **Terms:** Use of LeetRepo is subject to the [Terms and Conditions](TERMS.md), including user responsibilities, third-party service terms, and warranty limitations.
- **License:** LeetRepo's source code is available under the [MIT License](LICENSE).

## Development

Run the test suite:

```bash
npm test
```

Create the Chrome Web Store ZIP after setting the production API origin:

```bash
npm run package:extension
```

The archive is written to `dist/` and contains only the extension package, public notices, and assets. Server code, dependencies, and environment files are excluded.

The extraction code intentionally uses several fallback selectors because LeetCode changes its DOM regularly.

### Repository structure

```text
assets/
  marketing/             Campaign artboards, product captures, and final PNGs
  icon.svg               Extension icon source
server/                  Hosted OAuth, token refresh, AI proxy, quotas, and database schema
scripts/                 Release packaging helpers
src/
  background/            Manifest V3 service worker
  content/               LeetCode page integration
  core/                  Submission, GitHub, and explanation logic
  pages/                 Popup, options, onboarding, and dashboard UIs
  shared/                Shared UI helpers and styles
tests/                   Node unit tests
Dockerfile               Production API container
manifest.json            Extension entry point and permissions
```
