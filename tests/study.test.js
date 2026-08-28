import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStudyQueue,
  canonicalPattern,
  formatStudyInterval,
  nextReviewInterval,
  normalizeDailyStudyLimit,
  normalizeStudyInterval,
  patternCoverage,
  rescheduleFirstReview,
  reviewDueAfterSync,
  reviewDueAt,
  reviewsCompletedOn,
  scheduleReview,
  studyIntervalDays,
  snoozeReview,
  todaysReviewSummary
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

test("syncing again preserves a completed review cycle", () => {
  assert.equal(reviewDueAfterSync({}, "2026-08-08T12:00:00.000Z", 7), "2026-08-15T12:00:00.000Z");
  assert.equal(reviewDueAfterSync({
    reviewCount: 2,
    lastReviewedAt: "2026-08-05T12:00:00.000Z",
    reviewIntervalDays: 14,
    reviewDueAt: "2026-08-19T12:00:00.000Z"
  }, "2026-08-08T12:00:00.000Z", 7), "2026-08-19T12:00:00.000Z");
  assert.equal(reviewDueAfterSync({
    reviewCount: 1,
    lastReviewedAt: "2026-08-05T12:00:00.000Z",
    reviewIntervalDays: 14
  }, "2026-08-08T12:00:00.000Z", 7), "2026-08-19T12:00:00.000Z");
  assert.equal(reviewDueAfterSync({}, "2026-08-08T12:00:00.000Z", 7, false), null);
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
  assert.equal(snoozed.reviewEvents.length, 1, "snoozing does not log a review event");
});

test("scheduling a review appends to review-event history instead of replacing it", () => {
  const first = scheduleReview({ id: "1-two-sum" }, "hard", new Date("2026-08-01T12:00:00.000Z"));
  assert.deepEqual(first.reviewEvents, [
    { ratedAt: "2026-08-01T12:00:00.000Z", rating: "hard", intervalDaysAfter: 3, recall: "", durationSeconds: null }
  ]);
  const second = scheduleReview(first, "good", now, null, "", 95);
  assert.deepEqual(second.reviewEvents, [
    { ratedAt: "2026-08-01T12:00:00.000Z", rating: "hard", intervalDaysAfter: 3, recall: "", durationSeconds: null },
    { ratedAt: "2026-08-08T12:00:00.000Z", rating: "good", intervalDaysAfter: 7, recall: "", durationSeconds: 95 }
  ]);
});

test("scheduling a review records and bounds how long the recall took", () => {
  assert.equal(scheduleReview({ id: "1-two-sum" }, "good", now, null, "", 42).reviewEvents[0].durationSeconds, 42);
  assert.equal(scheduleReview({ id: "1-two-sum" }, "good", now, null, "", 10_000).reviewEvents[0].durationSeconds, 3_600, "duration is capped at one hour");
  assert.equal(scheduleReview({ id: "1-two-sum" }, "good", now, null, "", -5).reviewEvents[0].durationSeconds, null, "a negative duration is treated as unmeasured");
  assert.equal(scheduleReview({ id: "1-two-sum" }, "good", now).reviewEvents[0].durationSeconds, null);
});

test("scheduling a review records and bounds a written recall attempt", () => {
  const reviewed = scheduleReview({ id: "1-two-sum" }, "good", now, null, `  ${"x".repeat(2_500)}  `);
  assert.equal(reviewed.reviewEvents[0].recall.length, 2_000);
  assert.equal(scheduleReview({ id: "1-two-sum" }, "good", now).reviewEvents[0].recall, "");
});

test("review-event history is capped so storage cannot grow without bound", () => {
  let item = { id: "1-two-sum" };
  for (let i = 0; i < 205; i += 1) {
    item = scheduleReview(item, "good", new Date(now.getTime() + i * 1000));
  }
  assert.equal(item.reviewEvents.length, 200);
  assert.equal(item.reviewCount, 205);
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

test("daily study limit is bounded to a sane range", () => {
  assert.equal(normalizeDailyStudyLimit(5), 5);
  assert.equal(normalizeDailyStudyLimit(0), 10);
  assert.equal(normalizeDailyStudyLimit(-3), 10);
  assert.equal(normalizeDailyStudyLimit("not a number"), 10);
  assert.equal(normalizeDailyStudyLimit(500), 50);
});

test("reviewsCompletedOn counts only review events rated today", () => {
  const items = [
    { reviewEvents: [
      { ratedAt: new Date(now.getTime() - 3_600_000).toISOString(), rating: "good" },
      { ratedAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(), rating: "hard" }
    ] },
    { reviewEvents: [{ ratedAt: new Date(now.getTime() + 3_600_000).toISOString(), rating: "again" }] }
  ];
  assert.equal(reviewsCompletedOn(items, now), 2);
  assert.equal(reviewsCompletedOn([], now), 0);
});

test("todaysReviewSummary aggregates ratings, timing, and reviewed items from today only", () => {
  const items = [
    {
      id: "two-sum",
      title: "Two Sum",
      reviewEvents: [
        { ratedAt: new Date(now.getTime() - 10 * 60_000).toISOString(), rating: "good", durationSeconds: 30 },
        { ratedAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(), rating: "again", durationSeconds: 999 }
      ]
    },
    {
      id: "trapping-rain-water",
      title: "Trapping Rain Water",
      reviewEvents: [{ ratedAt: new Date(now.getTime() - 5 * 60_000).toISOString(), rating: "hard", durationSeconds: null }]
    }
  ];
  const summary = todaysReviewSummary(items, now);
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.ratings, { again: 0, hard: 1, good: 1 });
  assert.equal(summary.totalDurationSeconds, 30);
  assert.equal(summary.timedCount, 1);
  assert.deepEqual(summary.entries.map(({ item }) => item.id), ["trapping-rain-water", "two-sum"], "most recently reviewed comes first");
});

test("todaysReviewSummary is empty when nothing has been reviewed today", () => {
  const summary = todaysReviewSummary([], now);
  assert.equal(summary.count, 0);
  assert.deepEqual(summary.ratings, { again: 0, hard: 0, good: 0 });
  assert.equal(summary.totalDurationSeconds, 0);
  assert.equal(summary.timedCount, 0);
  assert.deepEqual(summary.entries, []);
});

test("today's plan caps the due queue at the daily limit and accounts for reviews already completed today", () => {
  const dueItems = Array.from({ length: 5 }, (_, index) => ({
    id: `due-${index}`,
    reviewDueAt: "2026-08-08T09:00:00.000Z"
  }));
  const uncapped = buildStudyQueue(dueItems, now, undefined, 10);
  assert.equal(uncapped.plan.length, 5);
  assert.equal(uncapped.planLimit, 10);
  assert.equal(uncapped.planTotal, 5);
  assert.equal(uncapped.completedToday, 0);

  const capped = buildStudyQueue(dueItems, now, undefined, 3);
  assert.deepEqual(capped.plan.map(({ item }) => item.id), ["due-0", "due-1", "due-2"]);
  assert.equal(capped.planTotal, 3);

  const alreadyReviewedToday = [
    { id: "reviewed-earlier", reviewDueAt: "2026-09-01T00:00:00.000Z", reviewEvents: [{ ratedAt: "2026-08-08T08:00:00.000Z", rating: "good" }] },
    ...dueItems
  ];
  const afterProgress = buildStudyQueue(alreadyReviewedToday, now, undefined, 3);
  assert.equal(afterProgress.completedToday, 1);
  assert.equal(afterProgress.plan.length, 2, "the daily limit already counts today's completed review");
  assert.equal(afterProgress.planTotal, 3);
});

test("topic coverage keeps LeetCode names and distinguishes due, rotation, and practiced", () => {
  const coverage = patternCoverage([
    { reviewDueAt: "2026-08-07T12:00:00.000Z", tags: ["Breadth-First Search"] },
    { reviewDueAt: "2026-08-20T12:00:00.000Z", tags: ["Hash Table"] },
    { reviewDueAt: "2026-08-20T12:00:00.000Z", tags: ["Stack"] },
    { reviewDueAt: "2026-08-21T12:00:00.000Z", tags: ["Stack"] },
    { reviewDueAt: "2026-08-22T12:00:00.000Z", tags: ["Stack"] }
  ], undefined, now);
  assert.equal(canonicalPattern("  Breadth-First   Search "), "Breadth-First Search");
  assert.equal(coverage.find(({ pattern }) => pattern === "Breadth-First Search").status, "due");
  assert.equal(coverage.find(({ pattern }) => pattern === "Hash Table").status, "rotation");
  assert.equal(coverage.find(({ pattern }) => pattern === "Stack").status, "practiced");
  assert.equal(coverage.some(({ status }) => status === "unseen"), false);
});
