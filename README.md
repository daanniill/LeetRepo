# LeetRepo

<p align="center">
  <strong>Solve it. Keep it.</strong><br>
  Turn every Accepted LeetCode submission into an organized GitHub archive and a study system built from your own solutions.
</p>

![Every accepted LeetCode solution documented and pushed to GitHub](https://raw.githubusercontent.com/daanniill/LeetRepo-Docs/main/assets/readme/hero.png)

LeetRepo is a Chrome/Chromium extension that saves Accepted LeetCode solutions to GitHub—complete with problem context, solve metadata, and optional AI-generated interview notes. Its built-in dashboard then helps you search, analyze, and review what you have solved.

**Automatic GitHub commits · Clean problem READMEs · Attempt history · Pattern analytics · Spaced repetition**

## What you can do

- **Save solutions automatically.** Push from LeetCode without copying and pasting code.
- **Keep your repository organized.** Store each problem, language, and README in a predictable structure.
- **Learn from every attempt.** Preserve failed and Accepted submissions so you can revisit your reasoning.
- **Prepare for interviews.** Search by pattern or difficulty and review problems on a spaced-repetition schedule.
- **Choose whether to use AI.** AI-generated notes are opt-in; the core GitHub workflow works without them.

## How it works

1. **Solve a problem on LeetCode.** LeetRepo detects the problem, language, code, result, and available performance metrics.
2. **Confirm the solution.** Push from the page panel or toolbar popup, or enable automatic pushes for newly Accepted submissions.
3. **Sync one clean commit.** LeetRepo creates or updates the problem folder without changing unrelated repository files.
4. **Review it later.** Use the local dashboard to search your library, explore activity, and work through your study queue.

A synced problem looks like this:

```text
0001-two-sum/
├── README.md
└── python/
    └── solution.py
```

The generated README can include solve metadata, problem context, complexity, personal notes, interview prompts, and an approach walkthrough. Solving the same problem in another language updates its existing folder while preserving the original solved time.

## Your solution dashboard

![LeetRepo solution library with synced problems and AI overviews](https://raw.githubusercontent.com/daanniill/LeetRepo-Docs/main/assets/readme/solution-library.png)

### Problems

Search and filter your solution library, read an interview overview, and jump back to the LeetCode problem or GitHub commit.

### Activity

Track repository growth, solve activity, pattern coverage, language usage, and the sequence of failed and Accepted attempts. You can also create a shareable progress image locally.

![LeetRepo solve activity, pattern coverage, and language breakdown](https://raw.githubusercontent.com/daanniill/LeetRepo-Docs/main/assets/readme/activity.png)

### Study

Review due and upcoming problems, recall a solution before revealing its refresher, and filter coverage by pattern or difficulty. You choose a review interval in days, weeks, or months; successful recalls use that interval while harder reviews return sooner.

![LeetRepo spaced-repetition study queue](https://raw.githubusercontent.com/daanniill/LeetRepo-Docs/main/assets/readme/study.png)

## Get started

You will need Chrome or another Chromium-based browser, a GitHub account, and a repository for your solutions.

1. **Install and open LeetRepo.** Select LeetRepo from your browser toolbar to begin onboarding.
2. **Connect GitHub.** Sign in when prompted, then choose which repositories LeetRepo can access.
3. **Choose your preferences.** Pick the destination repository and decide whether to use automatic pushes, AI notes, and study reminders.
4. **Solve and sync.** Open a problem on LeetCode, submit your solution, and save it from the LeetRepo panel or toolbar popup. Newly Accepted submissions can also sync automatically.

You can change repository access from GitHub and update your LeetRepo preferences at any time.

![LeetRepo appearance and repository settings](https://raw.githubusercontent.com/daanniill/LeetRepo-Docs/main/assets/readme/settings.png)

## Optional AI notes

AI notes are off by default. You can turn them on during onboarding, in Settings, or from the LeetCode page panel.

When enabled, AI can add an approach walkthrough, complexity analysis, interview prompts, and a diagram to the problem README. LeetRepo uses the problem details and your solution code to create these notes.

The free tier includes up to 3 requests per day and 30 per month. If AI notes are unavailable or you reach the limit, your solution still syncs with a standard README. Because generated notes can be inaccurate, review them before relying on them.

Turning AI off does not affect solution syncing, local feedback, or the dashboard.

## Privacy and safety

- You choose which repositories LeetRepo can access and can change that access later.
- LeetRepo can add and update files in selected repositories, but it cannot change repository settings or delete a repository.
- Syncing verifies that unrelated repository files remain unchanged.
- Shareable progress images stay on your device until you choose to copy or share them.
- Updating a repository's main profile README is always optional.
- Deleting your LeetRepo account removes your LeetRepo data and authorization without changing your repositories.

Read the [Privacy Notice](https://github.com/daanniill/LeetRepo-Docs/blob/main/policies/privacy.md), [Terms and Conditions](https://github.com/daanniill/LeetRepo-Docs/blob/main/policies/terms.md), and [Security Policy](https://github.com/daanniill/LeetRepo-Docs/blob/main/policies/security.md) for complete details.

## Documentation

The [LeetRepo documentation repository](https://github.com/daanniill/LeetRepo-Docs) is the canonical index for architecture, feature requirements, operations, policies, release collateral, and imported creative assets. It is also mounted locally at `docs/` as a Git submodule.

## License

LeetRepo is available under the [MIT License](LICENSE).
