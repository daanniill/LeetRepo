import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStudyQueue,
  canonicalPattern,
  formatStudyInterval,
  nextReviewInterval,
  normalizeStudyInterval,
  patternCoverage,
  rescheduleFirstReview,
  reviewDueAt,
  scheduleReview,
  studyIntervalDays,
  snoozeReview
} from "../src/core/study.js";

const now = new Date("2026-08-08T12:00:00.000Z");

test("legacy study records keep their explicit or 30-day fallback due date", () => {
  assert.equal(reviewDueAt({ syncedAt: "2026-08-01T12:00:00.000Z" }).toISOString(), "2026-08-31T12:00:00.000Z");
  assert.equal(reviewDueAt({ syncedAt: "2026-01-01T00:00:00.000Z", reviewDueAt: "2026-08-10T12:00:00.000Z" }).toISOString(), "2026-08-10T12:00:00.000Z");
  assert.equal(reviewDueAt({ syncedAt: "invalid" }), null);
});

test("review ratings produce bounded adaptive intervals", () => {
  assert.equal(nextReviewInterval({}, "again"), 1);
  assert.equal(nextReviewInterval({}, "hard"), 3);
  assert.equal(nextReviewInterval({}, "good"), 14);
  assert.equal(nextReviewInterval({ reviewCount: 3, reviewIntervalDays: 14 }, "hard"), 18);
  assert.equal(nextReviewInterval({ reviewCount: 3, reviewIntervalDays: 60 }, "good"), 90);
  assert.throws(() => nextReviewInterval({}, "easy"), /valid review rating/);
});

test("study interval preferences support days, weeks, and months", () => {
  assert.deepEqual(normalizeStudyInterval(2, "days"), { value: 2, unit: "days", days: 2 });
  assert.deepEqual(normalizeStudyInterval(1, "weeks"), { value: 1, unit: "weeks", days: 7 });
  assert.deepEqual(normalizeStudyInterval(2, "months"), { value: 2, unit: "months", days: 60 });
  assert.deepEqual(normalizeStudyInterval(99, "months"), { value: 12, unit: "months", days: 360 });
  assert.equal(studyIntervalDays({ studyIntervalValue: 3, studyIntervalUnit: "weeks" }), 21);
  assert.equal(formatStudyInterval(7), "1 week");
  assert.equal(formatStudyInterval(2), "2 days");
  assert.equal(formatStudyInterval(30, "days"), "30 days");
});

test("a preferred interval controls successful recall while lower ratings return sooner", () => {
  assert.equal(nextReviewInterval({}, "again", 7), 1);
  assert.equal(nextReviewInterval({}, "hard", 7), 4);
  assert.equal(nextReviewInterval({}, "good", 7), 7);
  const completed = scheduleReview({ id: "1-two-sum" }, "good", now, 7);
  assert.equal(completed.reviewDueAt, "2026-08-15T12:00:00.000Z");
  assert.equal(completed.reviewIntervalDays, 7);
});

test("changing the preference reschedules first reviews without moving completed reviews", () => {
  const pending = rescheduleFirstReview({ syncedAt: "2026-08-01T12:00:00.000Z" }, 7);
  assert.equal(pending.reviewDueAt, "2026-08-08T12:00:00.000Z");
  const completed = { syncedAt: "2026-08-01T12:00:00.000Z", lastReviewedAt: "2026-08-05T12:00:00.000Z", reviewDueAt: "2026-08-20T12:00:00.000Z" };
  assert.equal(rescheduleFirstReview(completed, 2).reviewDueAt, completed.reviewDueAt);
});

test("completing and snoozing a review update only the intended study state", () => {
  const completed = scheduleReview({ id: "1-two-sum", reviewCount: 2, reviewLapses: 1, reviewIntervalDays: 7 }, "again", now);
  assert.equal(completed.reviewDueAt, "2026-08-09T12:00:00.000Z");
  assert.equal(completed.reviewCount, 3);
  assert.equal(completed.reviewLapses, 2);
  assert.equal(completed.lastReviewRating, "again");
  const snoozed = snoozeReview(completed, now, 3);
  assert.equal(snoozed.reviewDueAt, "2026-08-11T12:00:00.000Z");
  assert.equal(snoozed.reviewCount, 3);
});

test("study queue exposes due, overdue, upcoming, and next-week groups", () => {
  const queue = buildStudyQueue([
    { id: "overdue", reviewDueAt: "2026-08-07T09:00:00.000Z", reviewCount: 2 },
    { id: "due", reviewDueAt: "2026-08-08T10:00:00.000Z" },
    { id: "soon", reviewDueAt: "2026-08-10T12:00:00.000Z", lastReviewedAt: "2026-08-01T12:00:00.000Z" },
    { id: "later", reviewDueAt: "2026-09-10T12:00:00.000Z" }
  ], now);
  assert.deepEqual(queue.due.map(({ item }) => item.id), ["overdue", "due"]);
  assert.deepEqual(queue.overdue.map(({ item }) => item.id), ["overdue"]);
  assert.deepEqual(queue.upcoming.map(({ item }) => item.id), ["soon", "later"]);
  assert.deepEqual(queue.nextSevenDays.map(({ item }) => item.id), ["soon"]);
  assert.equal(queue.totalReviews, 3);
});

test("pattern coverage normalizes aliases and distinguishes due, rotation, practiced, and unseen", () => {
  const coverage = patternCoverage([
    { reviewDueAt: "2026-08-07T12:00:00.000Z", review: { patterns: ["BFS"] } },
    { reviewDueAt: "2026-08-20T12:00:00.000Z", review: { patterns: ["Hash Map"] } },
    { reviewDueAt: "2026-08-20T12:00:00.000Z", review: { patterns: ["Stack"] } },
    { reviewDueAt: "2026-08-21T12:00:00.000Z", review: { patterns: ["Stack"] } },
    { reviewDueAt: "2026-08-22T12:00:00.000Z", review: { patterns: ["Stack"] } }
  ], undefined, now);
  assert.equal(canonicalPattern("bfs"), "Graph Traversal");
  assert.equal(coverage.find(({ pattern }) => pattern === "Graph Traversal").status, "due");
  assert.equal(coverage.find(({ pattern }) => pattern === "Arrays & Hashing").status, "rotation");
  assert.equal(coverage.find(({ pattern }) => pattern === "Stack").status, "practiced");
  assert.equal(coverage.find(({ pattern }) => pattern === "Trie").status, "unseen");
});
