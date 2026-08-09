import test from "node:test";
import assert from "node:assert/strict";
import {
  aiLimitReached,
  buildMermaidDiagram,
  buildReadme,
  buildProfileReadme,
  calculateStreak,
  dueForReview,
  folderFor,
  formatCommit,
  historyInsights,
  isSubmissionPushReady,
  languageFolderFor,
  mergeSubmissionSolutions,
  normalizeSubmission,
  normalizeTheme,
  relativeTime,
  sameProblem,
  submissionSolutions,
  slugify
} from "../src/core/submissions.js";

const submission = {
  number: 42,
  title: "Trapping Rain Water",
  difficulty: "Hard",
  language: "C++",
  code: "int trap(vector<int>& h) { return 0; }",
  problemContext: "Given an elevation map, compute how much rain water it can trap.",
  runtime: "52 ms",
  memory: "41.2 MB",
  url: "https://leetcode.com/problems/trapping-rain-water/"
};

test("slugify normalizes punctuation and accents", () => {
  assert.equal(slugify("  Déjà Vu: Arrays & Hashing! "), "deja-vu-arrays-hashing");
});

test("theme preference accepts known themes and falls back safely", () => {
  assert.equal(normalizeTheme("teal"), "teal");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("unexpected"), "system");
});

test("AI quota detection covers daily and monthly tier limits", () => {
  assert.equal(aiLimitReached({ daily: { requests: 3, limit: 3 }, monthly: { requests: 10, limit: 30 } }), true);
  assert.equal(aiLimitReached({ daily: { requests: 1, limit: 3 }, monthly: { requests: 30, limit: 30 } }), true);
  assert.equal(aiLimitReached({ daily: { requests: 2, limit: 3 }, monthly: { requests: 29, limit: 30 } }), false);
  assert.equal(aiLimitReached({}), false);
});

test("normalizeSubmission maps languages to extensions", () => {
  assert.equal(normalizeSubmission(submission).extension, "cpp");
  assert.equal(normalizeSubmission({ language: "Python3" }).extension, "py");
  assert.equal(normalizeSubmission({ language: "C#" }).extension, "cs");
  assert.equal(normalizeSubmission({ title: "Safe", slug: "../../unsafe/path" }).slug, "unsafe-path");
  assert.equal(normalizeSubmission({ syncedAt: "2026-08-07T12:34:56.000Z" }).solvedAt, "2026-08-07T12:34:56.000Z");
});

test("problem identity is stable when a title or slug changes", () => {
  assert.equal(sameProblem(submission, { ...submission, title: "Trapping Rainwater", slug: "trapping-rainwater" }), true);
  assert.equal(sameProblem(submission, { ...submission, number: 43 }), false);
});

test("problem records retain language variants and default to the latest solution", () => {
  const merged = mergeSubmissionSolutions(
    { ...submission, language: "Python3", code: "return 1", syncedAt: "2026-08-01T10:00:00.000Z" },
    { ...submission, language: "C++", code: "return 2;", syncedAt: "2026-08-07T10:00:00.000Z" }
  );
  assert.equal(merged.language, "C++");
  assert.equal(merged.code, "return 2;");
  assert.deepEqual(submissionSolutions(merged).map((solution) => solution.language), ["C++", "Python3"]);
});

test("repository backfill enriches an existing language without duplicating it", () => {
  const merged = mergeSubmissionSolutions(
    { ...submission, title: "Trapping Rain Water", language: "C++", code: "return 1;", syncedAt: "2026-08-07T10:00:00.000Z" },
    {
      number: 42,
      title: "Trapping Rain Water From Folder",
      slug: "trapping-rain-water",
      language: "C++",
      extension: "cpp",
      path: "0042-trapping-rain-water/cpp/solution.cpp",
      commitUrl: "https://github.com/alex-c/solutions/tree/main/0042-trapping-rain-water/cpp",
      syncedAt: "2026-08-07T10:00:00.000Z"
    }
  );
  assert.equal(merged.title, "Trapping Rain Water");
  assert.equal(merged.code, "return 1;");
  assert.equal(submissionSolutions(merged).length, 1);
  assert.equal(submissionSolutions(merged)[0].path, "0042-trapping-rain-water/cpp/solution.cpp");
});

test("push readiness requires code from a freshly accepted LeetCode submission", () => {
  assert.equal(isSubmissionPushReady({ code: "return 1", status: "Accepted", pushReady: true }), true);
  assert.equal(isSubmissionPushReady({ code: "return 1", status: "Accepted" }), false);
  assert.equal(isSubmissionPushReady({ code: "return 1", status: "Ready", pushReady: true }), false);
});

test("folder and commit formatting follow the configured convention", () => {
  assert.equal(folderFor(submission), "0042-trapping-rain-water");
  assert.equal(languageFolderFor(submission), "cpp");
  assert.equal(languageFolderFor({ language: "Python3" }), "python");
  assert.equal(languageFolderFor({ language: "C#" }), "csharp");
  assert.equal(formatCommit("solve: {number}. {title} [{language}]", submission), "solve: 42. Trapping Rain Water [C++]");
});

test("README defaults to basic LeetCode stats without a diagram", () => {
  const readme = buildReadme(submission);
  assert.match(readme, /# 42\. Trapping Rain Water/);
  assert.match(readme, /\*\*Runtime:\*\* 52 ms/);
  assert.match(readme, /View problem on LeetCode/);
  assert.doesNotMatch(readme, /Interview overview/);
  assert.doesNotMatch(readme, /```mermaid/);
});

test("README respects disabled optional sections", () => {
  const readme = buildReadme(submission, { includeLink: false, includeStats: false });
  assert.doesNotMatch(readme, /Runtime/);
  assert.doesNotMatch(readme, /Interview overview/);
  assert.doesNotMatch(readme, /Solution replay/);
  assert.doesNotMatch(readme, /View problem/);
});

test("README includes personal notes only when enabled", () => {
  const withNotes = { ...submission, notes: "Re-check the decreasing-height case." };
  const review = { patterns: ["Stack"], approach: ["Scan the bars."] };
  assert.match(buildReadme(withNotes, { aiEnabled: true }, review), /## Personal notes/);
  assert.doesNotMatch(buildReadme(withNotes, { aiEnabled: true, includeNotes: false }, review), /Personal notes/);
  assert.doesNotMatch(buildReadme(withNotes), /Personal notes/);
});

test("README shows the original solved timestamp", () => {
  const readme = buildReadme({ ...submission, solvedAt: "2026-08-07T12:34:56.000Z", syncedAt: "2026-08-09T08:00:00.000Z" });
  assert.match(readme, /\*\*Solved:\*\* 2026-08-07 12:34 UTC/);
  assert.doesNotMatch(readme, /2026-08-09/);
});

test("profile README summarizes real history without inventing totals", () => {
  const history = [
    { ...submission, syncedAt: "2026-08-07T12:00:00.000Z" },
    { ...submission, number: 1, title: "Two Sum", difficulty: "Easy", language: "Python3", code: "seen = {}", syncedAt: "2026-08-06T12:00:00.000Z" }
  ];
  const profile = buildProfileReadme(history, { owner: "alex-c", repo: "solutions" });
  assert.match(profile, /# alex-c \/ solutions/);
  assert.match(profile, /\*\*2 solved\*\*/);
  assert.match(profile, /\| 1 \| \[Two Sum\]/);
  assert.equal(historyInsights(history).languages.length, 2);
});

test("review queue respects generated and snoozed due dates", () => {
  const items = [
    { ...submission, syncedAt: "2026-06-01T12:00:00.000Z" },
    { ...submission, number: 1, title: "Two Sum", syncedAt: "2026-08-01T12:00:00.000Z" },
    { ...submission, number: 2, title: "Add Two Numbers", syncedAt: "2026-01-01T12:00:00.000Z", reviewDueAt: "2026-08-10T12:00:00.000Z" }
  ];
  assert.deepEqual(dueForReview(items, new Date("2026-08-07T12:00:00.000Z")).map((item) => item.number), [42]);
});

test("README renders a validated AI explanation with a verification note", () => {
  const readme = buildReadme(submission, { aiEnabled: true }, {
    summary: "A monotonic structure tracks useful candidates.",
    patterns: ["Monotonic Stack"],
    approach: ["Scan the input.", "Remove dominated candidates.", "Compute the answer."],
    complexity: { time: "O(n), with each item processed once.", space: "O(n) for the stack." },
    edgeCases: ["Empty input", "Monotonic input"],
    visual: {
      context: "Compute trapped water between elevation bars.",
      input: "heights=[0,1,0,2]",
      invariant: "The stack keeps unresolved decreasing heights.",
      steps: [["Read height", "stack=[0,1]"], ["Find boundary", "pop the lower bar"]],
      result: "trapped water increases"
    },
    generatedBy: "Groq"
  });
  assert.match(readme, /### Approach/);
  assert.match(readme, /### Complexity/);
  assert.match(readme, /### Edge cases/);
  assert.match(readme, /Goal<br\/>Compute trapped water between elevation bars/);
  assert.match(readme, /heights=\[0,1,0,2\]/);
  assert.match(readme, /Step 2: Find boundary<br\/>pop the lower bar/);
  assert.match(readme, /AI-generated with Groq/);
});

test("README ignores a supplied AI review when the user has opted out", () => {
  const readme = buildReadme(submission, { aiEnabled: false }, {
    summary: "This content must not be included.",
    patterns: ["Two Pointers"],
    approach: ["Build a diagram."],
    generatedBy: "Groq"
  });
  assert.doesNotMatch(readme, /This content must not be included/);
  assert.doesNotMatch(readme, /mermaid|AI-generated/);
});

test("Mermaid replay falls back by pattern and escapes untrusted labels", () => {
  const diagram = buildMermaidDiagram({
    ...submission,
    exampleInput: "[1, 2] ` ``` <script>",
    exampleOutput: "2"
  }, { patterns: ["Two Pointers"] });
  assert.match(diagram, /^flowchart TD/);
  assert.match(diagram, /Goal<br\/>Given an elevation map/);
  assert.match(diagram, /Everything outside the pointers/);
  assert.match(diagram, /Sample output<br\/>Expected output: 2/);
  assert.doesNotMatch(diagram, /```/);
  assert.doesNotMatch(diagram, /<script>/);
});

test("legacy AI visuals inherit the captured problem context", () => {
  const diagram = buildMermaidDiagram(submission, {
    visual: {
      input: "height=[2,0,2]",
      invariant: "resolved bars never need to be revisited",
      steps: [["Read left bar", "leftMax=2"], ["Read middle bar", "water=2"]],
      result: "2"
    }
  });
  assert.match(diagram, /Goal<br\/>Given an elevation map/);
  assert.match(diagram, /Sample input<br\/>height=\[2,0,2\]/);
});

test("calculateStreak counts consecutive UTC solve days", () => {
  const history = ["2026-08-07", "2026-08-06", "2026-08-05"].map((date) => ({ syncedAt: `${date}T12:00:00.000Z` }));
  assert.equal(calculateStreak(history, new Date("2026-08-07T20:00:00.000Z")), 3);
});

test("streak may start yesterday when today has no push", () => {
  const history = ["2026-08-06", "2026-08-05"].map((date) => ({ syncedAt: `${date}T12:00:00.000Z` }));
  assert.equal(calculateStreak(history, new Date("2026-08-07T20:00:00.000Z")), 2);
});

test("relativeTime uses compact labels", () => {
  const now = Date.parse("2026-08-07T12:00:00.000Z");
  assert.equal(relativeTime("2026-08-07T11:58:00.000Z", now), "2m ago");
  assert.equal(relativeTime("2026-08-06T12:00:00.000Z", now), "yesterday");
});
