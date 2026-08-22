const DAY_MS = 24 * 60 * 60 * 1000;

export const INITIAL_REVIEW_INTERVAL_DAYS = 30;
export const REVIEW_RATINGS = ["again", "hard", "good"];
export const STUDY_INTERVAL_UNITS = ["days", "weeks", "months"];
const INTERVAL_UNIT_DAYS = { days: 1, weeks: 7, months: 30 };
const INTERVAL_UNIT_MAX = { days: 365, weeks: 52, months: 12 };

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function reviewDateAfter(value, days) {
  const date = validDate(value);
  if (!date) return null;
  return addDays(date, positiveInteger(days) || INITIAL_REVIEW_INTERVAL_DAYS).toISOString();
}

export function reviewDueAfterSync(item = {}, syncedAt, initialIntervalDays = INITIAL_REVIEW_INTERVAL_DAYS, enabled = true) {
  if (!enabled) return null;
  if (nonNegativeInteger(item.reviewCount) > 0 || item.lastReviewedAt) {
    return validDate(item.reviewDueAt)?.toISOString()
      || reviewDateAfter(item.lastReviewedAt, item.reviewIntervalDays || initialIntervalDays);
  }
  return reviewDateAfter(syncedAt, initialIntervalDays);
}

export function canonicalPattern(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeStudyInterval(value = INITIAL_REVIEW_INTERVAL_DAYS, unit = "days") {
  const normalizedUnit = STUDY_INTERVAL_UNITS.includes(unit) ? unit : "days";
  const requested = positiveInteger(value) || INITIAL_REVIEW_INTERVAL_DAYS;
  const normalizedValue = Math.min(requested, INTERVAL_UNIT_MAX[normalizedUnit]);
  return { value: normalizedValue, unit: normalizedUnit, days: normalizedValue * INTERVAL_UNIT_DAYS[normalizedUnit] };
}

export function studyIntervalDays(settings = {}) {
  return normalizeStudyInterval(settings.studyIntervalValue, settings.studyIntervalUnit).days;
}

export function formatStudyInterval(days, preferredUnit = null) {
  const value = positiveInteger(days) || 1;
  if (STUDY_INTERVAL_UNITS.includes(preferredUnit) && value % INTERVAL_UNIT_DAYS[preferredUnit] === 0) {
    const unitValue = value / INTERVAL_UNIT_DAYS[preferredUnit];
    const singular = preferredUnit.slice(0, -1);
    return `${unitValue} ${unitValue === 1 ? singular : preferredUnit}`;
  }
  if (value % 30 === 0) return `${value / 30} month${value === 30 ? "" : "s"}`;
  if (value % 7 === 0) return `${value / 7} week${value === 7 ? "" : "s"}`;
  return `${value} day${value === 1 ? "" : "s"}`;
}

export function reviewDueAt(item = {}, initialIntervalDays = INITIAL_REVIEW_INTERVAL_DAYS) {
  const stored = validDate(item.reviewDueAt);
  if (stored) return stored;
  const base = validDate(item.lastReviewedAt || item.syncedAt);
  if (!base) return null;
  return addDays(base, positiveInteger(item.reviewIntervalDays) || initialIntervalDays);
}

export function dueForReview(items = [], now = new Date()) {
  const current = validDate(now) || new Date();
  return items
    .filter((item) => {
      const due = reviewDueAt(item);
      return due && due <= current;
    })
    .sort((left, right) => reviewDueAt(left) - reviewDueAt(right));
}

export function nextReviewInterval(item = {}, rating, preferredIntervalDays = null) {
  if (!REVIEW_RATINGS.includes(rating)) throw new Error("Choose a valid review rating.");
  const preferred = positiveInteger(preferredIntervalDays);
  if (preferred) {
    if (rating === "again") return 1;
    if (rating === "hard") return Math.max(1, Math.ceil(preferred / 2));
    return preferred;
  }
  const reviewCount = nonNegativeInteger(item.reviewCount);
  const current = positiveInteger(item.reviewIntervalDays);
  if (rating === "again") return 1;
  if (rating === "hard") return reviewCount === 0 ? 3 : Math.min(45, Math.max(3, Math.ceil((current || 3) * 1.25)));
  return reviewCount === 0 ? 14 : Math.min(90, Math.max(7, Math.ceil((current || 7) * 2)));
}

export function scheduleReview(item = {}, rating, now = new Date(), preferredIntervalDays = null) {
  const reviewedAt = validDate(now) || new Date();
  const intervalDays = nextReviewInterval(item, rating, preferredIntervalDays);
  return {
    ...item,
    lastReviewedAt: reviewedAt.toISOString(),
    reviewDueAt: addDays(reviewedAt, intervalDays).toISOString(),
    reviewIntervalDays: intervalDays,
    reviewCount: nonNegativeInteger(item.reviewCount) + 1,
    reviewLapses: nonNegativeInteger(item.reviewLapses) + (rating === "again" ? 1 : 0),
    lastReviewRating: rating
  };
}

export function rescheduleFirstReview(item = {}, intervalDays = INITIAL_REVIEW_INTERVAL_DAYS) {
  const syncedAt = validDate(item.syncedAt);
  if (!syncedAt || nonNegativeInteger(item.reviewCount) > 0 || item.lastReviewedAt) return item;
  return { ...item, reviewDueAt: reviewDateAfter(syncedAt, intervalDays) };
}

export function snoozeReview(item = {}, now = new Date(), days = 3) {
  const snoozedAt = validDate(now) || new Date();
  const snoozeDays = positiveInteger(days) || 3;
  return { ...item, reviewDueAt: addDays(snoozedAt, snoozeDays).toISOString() };
}

export function buildStudyQueue(items = [], now = new Date(), initialIntervalDays = INITIAL_REVIEW_INTERVAL_DAYS) {
  const current = validDate(now) || new Date();
  const startOfToday = new Date(current);
  startOfToday.setHours(0, 0, 0, 0);
  const nextWeek = new Date(current.getTime() + 7 * DAY_MS);
  const scheduled = items
    .map((item) => ({ item, dueAt: reviewDueAt(item, initialIntervalDays) }))
    .filter((entry) => entry.dueAt)
    .sort((left, right) => left.dueAt - right.dueAt);
  const due = scheduled.filter((entry) => entry.dueAt <= current);
  const upcoming = scheduled.filter((entry) => entry.dueAt > current);
  return {
    due,
    upcoming,
    overdue: due.filter((entry) => entry.dueAt < startOfToday),
    nextSevenDays: upcoming.filter((entry) => entry.dueAt <= nextWeek),
    totalReviews: items.reduce((total, item) => total + Math.max(nonNegativeInteger(item.reviewCount), item.lastReviewedAt ? 1 : 0), 0)
  };
}

export function patternCoverage(items = [], patternsFor = (item) => item.tags || [], now = new Date(), initialIntervalDays = INITIAL_REVIEW_INTERVAL_DAYS) {
  const current = validDate(now) || new Date();
  const entries = new Map();
  for (const item of items) {
    const dueAt = reviewDueAt(item, initialIntervalDays);
    const patterns = [...new Set((patternsFor(item) || []).map(canonicalPattern).filter(Boolean))];
    for (const pattern of patterns) {
      if (!entries.has(pattern)) entries.set(pattern, { pattern, count: 0, dueCount: 0 });
      const entry = entries.get(pattern);
      entry.count += 1;
      if (dueAt && dueAt <= current) entry.dueCount += 1;
    }
  }
  return [...entries.values()].map((entry) => ({
    ...entry,
    status: entry.dueCount > 0 ? "due" : entry.count >= 3 ? "practiced" : entry.count > 0 ? "rotation" : "unseen"
  }));
}
