import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReadme,
  calculateStreak,
  folderFor,
  formatCommit,
  normalizeSubmission,
  relativeTime,
  slugify
} from "../src/core/submissions.js";

const submission = {
  number: 42,
  title: "Trapping Rain Water",
  difficulty: "Hard",
  language: "C++",
  code: "int trap(vector<int>& h) { return 0; }",
  runtime: "52 ms",
  memory: "41.2 MB",
  url: "https://leetcode.com/problems/trapping-rain-water/"
};

test("slugify normalizes punctuation and accents", () => {
  assert.equal(slugify("  Déjà Vu: Arrays & Hashing! "), "deja-vu-arrays-hashing");
});

test("normalizeSubmission maps languages to extensions", () => {
  assert.equal(normalizeSubmission(submission).extension, "cpp");
  assert.equal(normalizeSubmission({ language: "Python3" }).extension, "py");
  assert.equal(normalizeSubmission({ title: "Safe", slug: "../../unsafe/path" }).slug, "unsafe-path");
});

test("folder and commit formatting follow the configured convention", () => {
  assert.equal(folderFor(submission), "0042-trapping-rain-water");
  assert.equal(formatCommit("solve: {number}. {title} [{language}]", submission), "solve: 42. Trapping Rain Water [C++]");
});

test("README includes metadata and interview prompts", () => {
  const readme = buildReadme(submission);
  assert.match(readme, /# 42\. Trapping Rain Water/);
  assert.match(readme, /\*\*Runtime:\*\* 52 ms/);
  assert.match(readme, /## Interview overview/);
  assert.match(readme, /View problem on LeetCode/);
});

test("README respects disabled optional sections", () => {
  const readme = buildReadme(submission, { includeLink: false, includeStats: false, includeReview: false });
  assert.doesNotMatch(readme, /Runtime/);
  assert.doesNotMatch(readme, /Interview overview/);
  assert.doesNotMatch(readme, /View problem/);
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
