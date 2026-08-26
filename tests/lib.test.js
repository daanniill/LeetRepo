import test from "node:test";
import assert from "node:assert/strict";
import {
  aiSubmissionPayload,
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
  parseReadmeData,
  relativeTime,
  reusableGeneratedReview,
  sameProblem,
  submissionSearchText,
  submissionSolutions,
  slugify
} from "../src/core/submissions.js";

const submission = {
  number: 42,
  title: "Trapping Rain Water",
  difficulty: "Hard",
  tags: ["Array", "Two Pointers", "Dynamic Programming", "Stack", "Monotonic Stack"],
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

test("AI payload includes only bounded fields needed for analysis", () => {
  const payload = aiSubmissionPayload({
    ...submission,
    code: "x".repeat(25_000),
    notes: "Do not transmit this note.",
    hints: ["Do not transmit every hint."],
    examples: [
      { input: "first", output: "1" },
      { input: "second", output: "2" }
    ],
    constraints: Array.from({ length: 15 }, (_, index) => `constraint ${index}`)
  });
  assert.equal(payload.code.length, 24_000);
  assert.equal(payload.examples.length, 1);
  assert.equal(payload.constraints.length, 12);
  assert.equal("notes" in payload, false);
  assert.equal("hints" in payload, false);
});

test("normalizeSubmission maps languages to extensions", () => {
  assert.equal(normalizeSubmission(submission).extension, "cpp");
  assert.equal(normalizeSubmission({ language: "Python3" }).extension, "py");
  assert.equal(normalizeSubmission({ language: "C#" }).extension, "cs");
  assert.equal(normalizeSubmission({ title: "Safe", slug: "../../unsafe/path" }).slug, "unsafe-path");
  assert.equal(normalizeSubmission({ syncedAt: "2026-08-07T12:34:56.000Z" }).solvedAt, "2026-08-07T12:34:56.000Z");
  assert.deepEqual(normalizeSubmission({ tags: [" Array ", "Hash   Table", "Array", ""] }).tags, ["Array", "Hash Table"]);
  const enriched = normalizeSubmission({
    problemDescription: "Full official statement.",
    examples: [{ input: "n = 1", output: "1", explanation: "Base case." }],
    constraints: [" 1 <= n <= 10 ", "1 <= n <= 10"],
    hints: ["Use a map."],
    followUp: "Can you use constant space?"
  });
  assert.equal(enriched.problemContext, "Full official statement.");
  assert.deepEqual(enriched.examples, [{ input: "n = 1", output: "1", explanation: "Base case." }]);
  assert.deepEqual(enriched.constraints, ["1 <= n <= 10"]);
});

test("problem identity is stable when a title or slug changes", () => {
  assert.equal(sameProblem(submission, { ...submission, title: "Trapping Rainwater", slug: "trapping-rainwater" }), true);
  assert.equal(sameProblem(submission, { ...submission, number: 43 }), false);
});

test("problem records retain language variants and default to the latest solution", () => {
  const merged = mergeSubmissionSolutions(
    { ...submission, language: "Python3", code: "return 1", syncedAt: "2026-08-01T10:00:00.000Z", reviewIntervalDays: 14, reviewCount: 2, reviewLapses: 1, lastReviewRating: "hard" },
    { ...submission, language: "C++", code: "return 2;", syncedAt: "2026-08-07T10:00:00.000Z" }
  );
  assert.equal(merged.language, "C++");
  assert.equal(merged.code, "return 2;");
  assert.equal(merged.reviewIntervalDays, 14);
  assert.equal(merged.reviewCount, 2);
  assert.equal(merged.reviewLapses, 1);
  assert.equal(merged.lastReviewRating, "hard");
  assert.deepEqual(submissionSolutions(merged).map((solution) => solution.language), ["C++", "Python3"]);
  assert.deepEqual(historyInsights([merged]).languages, [["C++", 1], ["Python3", 1]]);
  const searchable = { ...merged, notes: "Re-check equal heights.", review: { patterns: ["Invented AI Tag"] } };
  assert.match(submissionSearchText(searchable), /two pointers/);
  assert.doesNotMatch(submissionSearchText(searchable), /invented ai tag/);
  assert.match(submissionSearchText(searchable), /re-check equal heights/);
});

test("an unchanged language solution can reuse its generated review", () => {
  const review = { summary: "Use a stack.", generatedBy: "Groq" };
  const existing = {
    ...submission,
    language: "Python3",
    code: "return 1",
    review,
    solutions: [{ language: "C++", extension: "cpp", code: "return 2;", review: { summary: "Use two pointers.", generatedBy: "Groq" } }]
  };
  assert.equal(reusableGeneratedReview(existing, { ...submission, language: "C++", code: "return 2;" }).summary, "Use two pointers.");
  assert.equal(reusableGeneratedReview(existing, { ...submission, language: "C++", code: "return 3;" }), null);
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

test("normalizeSubmission validates and bounds review-event history", () => {
  const item = normalizeSubmission({
    ...submission,
    reviewEvents: [
      { ratedAt: "2026-08-01T12:00:00.000Z", rating: "good", intervalDaysAfter: 14 },
      { ratedAt: "not-a-date", rating: "good", intervalDaysAfter: 14 },
      { ratedAt: "2026-08-02T12:00:00.000Z", rating: "invalid-rating", intervalDaysAfter: 14 },
      { ratedAt: "2026-08-03T12:00:00.000Z", rating: "hard", intervalDaysAfter: -1 },
      "not-an-object"
    ]
  });
  assert.deepEqual(item.reviewEvents, [
    { ratedAt: "2026-08-01T12:00:00.000Z", rating: "good", intervalDaysAfter: 14 }
  ]);
  assert.deepEqual(normalizeSubmission(submission).reviewEvents, []);
});

test("resyncing a re-pushed solution unions review-event history instead of dropping it", () => {
  const existing = {
    ...submission,
    reviewCount: 1,
    reviewEvents: [{ ratedAt: "2026-08-01T12:00:00.000Z", rating: "hard", intervalDaysAfter: 3 }]
  };
  const merged = mergeSubmissionSolutions(existing, { ...submission, code: "return 2;", syncedAt: "2026-08-07T10:00:00.000Z" });
  assert.deepEqual(merged.reviewEvents, [{ ratedAt: "2026-08-01T12:00:00.000Z", rating: "hard", intervalDaysAfter: 3 }]);

  const rereviewed = mergeSubmissionSolutions(merged, {
    ...submission,
    reviewEvents: [{ ratedAt: "2026-08-09T12:00:00.000Z", rating: "good", intervalDaysAfter: 14 }]
  });
  assert.deepEqual(rereviewed.reviewEvents, [
    { ratedAt: "2026-08-01T12:00:00.000Z", rating: "hard", intervalDaysAfter: 3 },
    { ratedAt: "2026-08-09T12:00:00.000Z", rating: "good", intervalDaysAfter: 14 }
  ]);
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

test("README defaults to official problem details without an AI diagram", () => {
  const readme = buildReadme(submission);
  assert.match(readme, /# 42\. Trapping Rain Water/);
  assert.match(readme, /\*\*Runtime:\*\* 52 ms/);
  assert.match(readme, /## Problem description/);
  assert.match(readme, /Given an elevation map, compute how much rain water it can trap\./);
  assert.match(readme, /View problem on LeetCode/);
  assert.match(readme, /## Solution metadata/);
  assert.match(readme, /\[C\+\+\]\(\.\/cpp\/solution\.cpp\)/);
  assert.match(readme, /## Study guide/);
  assert.match(readme, /\*\*Topics:\*\* Array, Two Pointers, Dynamic Programming, Stack, Monotonic Stack/);
  assert.doesNotMatch(readme, /Interview overview/);
  assert.doesNotMatch(readme, /```mermaid/);
});

test("README renders captured official examples, constraints, follow-up, and hints without AI", () => {
  const readme = buildReadme({
    ...submission,
    problemDescription: "Given an elevation map, return the trapped water.",
    examples: [{ input: "height = [2,0,2]", output: "2", explanation: "The middle bar holds two units." }],
    constraints: ["1 <= height.length <= 2 * 10^4"],
    followUp: "Can you solve it with constant extra space?",
    hints: ["Compare the maximum height on each side."]
  });
  assert.match(readme, /## Examples/);
  assert.match(readme, /Input:\nheight = \[2,0,2\]/);
  assert.match(readme, /## Constraints/);
  assert.match(readme, /## Follow-up/);
  assert.match(readme, /<summary>Reveal official hints<\/summary>/);
  assert.doesNotMatch(readme, /Interview overview|```mermaid/);
});

test("README omits an empty problem description", () => {
  const readme = buildReadme({ ...submission, problemContext: "" });
  assert.doesNotMatch(readme, /## Problem description/);
});

test("README respects disabled optional sections", () => {
  const readme = buildReadme(submission, { includeLink: false, includeStats: false });
  assert.doesNotMatch(readme, /Runtime/);
  assert.doesNotMatch(readme, /Interview overview/);
  assert.doesNotMatch(readme, /Solution replay/);
  assert.doesNotMatch(readme, /View problem/);
});

test("README stores personal notes in GitHub unless their visible section is disabled", () => {
  const withNotes = { ...submission, notes: "Re-check the decreasing-height case." };
  const review = { patterns: ["Stack"], approach: ["Scan the bars."] };
  assert.match(buildReadme(withNotes, { aiEnabled: true }, review), /## Personal notes/);
  assert.doesNotMatch(buildReadme(withNotes, { aiEnabled: true, includeNotes: false }, review), /Personal notes/);
  assert.match(buildReadme(withNotes), /## Personal notes/);
  assert.equal(parseReadmeData(buildReadme(withNotes, { includeNotes: false })).notes, withNotes.notes);
});

test("tagged README data round-trips problem, solution, AI, notes, and study fields", () => {
  const review = {
    summary: "Track complements in a hash map.",
    approach: ["Scan once.", "Return the stored complement."],
    complexity: { time: "O(n)", space: "O(n)" },
    generatedBy: "Groq"
  };
  const original = {
    ...submission,
    notes: "Check duplicate values.",
    reviewDueAt: "2026-09-01T00:00:00.000Z",
    reviewCount: 2
  };
  const parsed = parseReadmeData(buildReadme(original, { aiEnabled: true }, review));
  assert.equal(parsed.problemDescription, original.problemContext);
  assert.equal(parsed.code, original.code);
  assert.equal(parsed.review.summary, review.summary);
  assert.equal(parsed.notes, original.notes);
  assert.equal(parsed.reviewDueAt, original.reviewDueAt);
  assert.equal(parsed.reviewCount, 2);
  assert.equal(parsed.path, "0042-trapping-rain-water/cpp/solution.cpp");
});

test("legacy LeetRepo Markdown backfills visible AI feedback and notes", () => {
  const parsed = parseReadmeData(`# 1. Two Sum

[View problem on LeetCode](https://leetcode.com/problems/two-sum/)

## Solution metadata

- **Difficulty:** Easy
- **Language:** Python3
- **Topics:** Array, Hash Table
- **Solved:** 2026-08-07 12:34 UTC

## Problem description

Find a matching pair.

## Interview overview

> Generated from the submitted solution and the official problem details above.

Use a hash map.

### Approach

1. Scan once.
2. Return the stored complement.

### Complexity

- **Time:** O(n)
- **Space:** O(n)

_AI-generated with Groq; verify the analysis before relying on it._

## Personal notes

Check duplicate values.`);
  assert.equal(parsed.problemDescription, "Find a matching pair.");
  assert.equal(parsed.review.summary, "Use a hash map.");
  assert.deepEqual(parsed.review.approach, ["Scan once.", "Return the stored complement."]);
  assert.equal(parsed.review.generatedBy, "Groq");
  assert.equal(parsed.notes, "Check duplicate values.");
  assert.equal(parsed.solvedAt, "2026-08-07T12:34:00.000Z");
});

test("README shows the original solved timestamp", () => {
  const readme = buildReadme({ ...submission, solvedAt: "2026-08-07T12:34:56.000Z", syncedAt: "2026-08-09T08:00:00.000Z" });
  assert.match(readme, /\*\*Solved:\*\* 2026-08-07 12:34 UTC/);
  assert.doesNotMatch(readme, /2026-08-09/);
  assert.doesNotMatch(buildReadme(submission), /1970-01-01/);
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

test("README preserves committed AI feedback after opt-out but ignores unsourced feedback", () => {
  const generated = buildReadme(submission, { aiEnabled: false }, {
    summary: "Keep this previously generated feedback.",
    approach: ["Build a diagram."],
    generatedBy: "Groq"
  });
  const unsourced = buildReadme(submission, { aiEnabled: false }, {
    summary: "This content must not be included.",
    patterns: ["Two Pointers"],
    approach: ["Build a diagram."]
  });
  assert.match(generated, /Keep this previously generated feedback/);
  assert.match(generated, /AI-generated with Groq/);
  assert.doesNotMatch(unsourced, /This content must not be included/);
  assert.doesNotMatch(unsourced, /mermaid|AI-generated/);
});

test("Mermaid replay falls back by a LeetCode topic and escapes untrusted labels", () => {
  const diagram = buildMermaidDiagram({
    ...submission,
    tags: ["Two Pointers"],
    exampleInput: "[1, 2] ` ``` <script>",
    exampleOutput: "2"
  });
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

test("streak retains original solve days when solutions are re-synced", () => {
  const history = ["2026-08-09", "2026-08-08"].map((date) => ({
    solvedAt: `${date}T12:00:00.000Z`,
    syncedAt: "2026-08-10T12:00:00.000Z"
  }));
  assert.equal(calculateStreak(history, new Date("2026-08-10T20:00:00.000Z")), 2);
});

test("relativeTime uses compact labels", () => {
  const now = Date.parse("2026-08-07T12:00:00.000Z");
  assert.equal(relativeTime("2026-08-07T11:58:00.000Z", now), "2m ago");
  assert.equal(relativeTime("2026-08-06T12:00:00.000Z", now), "yesterday");
});
