import test from "node:test";
import assert from "node:assert/strict";

function createStorageArea(initial = {}) {
  const store = { ...initial };
  return {
    async get(keys) {
      if (keys == null) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.map((key) => [key, store[key]]));
    },
    async set(value) {
      Object.assign(store, value);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    },
    async clear() {
      for (const key of Object.keys(store)) delete store[key];
    }
  };
}

function createChromeMock({ local = {}, sync = {} } = {}) {
  const createdTabs = [];
  return {
    storage: {
      local: createStorageArea(local),
      sync: createStorageArea(sync),
      session: createStorageArea({}),
      onChanged: { addListener() {} }
    },
    runtime: {
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      getURL: (path) => `chrome-extension://mock/${path}`,
      openOptionsPage: async () => {}
    },
    tabs: { create: async ({ url }) => { createdTabs.push(url); } },
    identity: { getRedirectURL: () => "https://mock.example/redirect" },
    createdTabs
  };
}

// service-worker.js reads the bare `chrome` global at call time (it isn't imported),
// so swapping globalThis.chrome between tests is enough to give each test isolated storage.
globalThis.chrome = createChromeMock();
const { handle, recordPush } = await import("../src/background/service-worker.js");

const onboardedSettings = { owner: "alex-c", repo: "solutions", branch: "main", spacedRepetition: true };

test("recordPush assigns a first review date only on the initial sync", async () => {
  globalThis.chrome = createChromeMock({ local: { submissions: [] } });
  const item = await recordPush(
    { number: "1", title: "Two Sum", language: "Python3", code: "return []" },
    { url: "https://github.com/x/y/commit/1", sha: "abc" },
    null,
    { spacedRepetition: true, studyIntervalValue: 7, studyIntervalUnit: "days" }
  );
  assert.equal(item.reviewCount, 0);
  assert.deepEqual(item.reviewEvents, []);
  const expected = new Date(item.syncedAt);
  expected.setUTCDate(expected.getUTCDate() + 7);
  assert.equal(item.reviewDueAt, expected.toISOString());
});

test("recordPush preserves an earned review schedule and event history when a solution is re-pushed", async () => {
  const existing = {
    id: "1-two-sum",
    number: "1",
    title: "Two Sum",
    language: "Python3",
    code: "old code",
    reviewCount: 2,
    reviewIntervalDays: 14,
    reviewDueAt: "2026-09-01T00:00:00.000Z",
    lastReviewedAt: "2026-08-18T00:00:00.000Z",
    lastReviewRating: "good",
    reviewEvents: [
      { ratedAt: "2026-08-01T00:00:00.000Z", rating: "hard", intervalDaysAfter: 3 },
      { ratedAt: "2026-08-18T00:00:00.000Z", rating: "good", intervalDaysAfter: 14 }
    ]
  };
  globalThis.chrome = createChromeMock({ local: { submissions: [existing] } });
  const item = await recordPush(
    { number: "1", title: "Two Sum", language: "Python3", code: "old code // tidy comment" },
    { url: "https://github.com/x/y/commit/2", sha: "def" },
    null,
    { spacedRepetition: true, studyIntervalValue: 30, studyIntervalUnit: "days" }
  );
  assert.equal(item.reviewDueAt, "2026-09-01T00:00:00.000Z", "a resync must not reset an earned due date");
  assert.equal(item.reviewCount, 2);
  assert.deepEqual(item.reviewEvents, existing.reviewEvents);
});

test("RATE_REVIEW advances the schedule and logs a review event via the message handler", async () => {
  globalThis.chrome = createChromeMock({
    local: { submissions: [{ id: "1-two-sum", number: "1", title: "Two Sum", reviewCount: 0 }], leetrepoSessionToken: "token" },
    sync: { settings: onboardedSettings }
  });
  const response = await handle({ type: "RATE_REVIEW", id: "1-two-sum", rating: "good" });
  assert.equal(response.submission.reviewCount, 1);
  assert.equal(response.submission.lastReviewRating, "good");
  assert.equal(response.submission.reviewEvents.length, 1);
});

test("SNOOZE_REVIEW defers the due date without logging a review event", async () => {
  globalThis.chrome = createChromeMock({
    local: {
      submissions: [{
        id: "1-two-sum",
        number: "1",
        title: "Two Sum",
        reviewCount: 1,
        reviewEvents: [{ ratedAt: "2026-08-01T00:00:00.000Z", rating: "good", intervalDaysAfter: 14 }]
      }],
      leetrepoSessionToken: "token"
    },
    sync: { settings: onboardedSettings }
  });
  const response = await handle({ type: "SNOOZE_REVIEW", id: "1-two-sum" });
  assert.equal(response.submission.reviewCount, 1);
  assert.equal(response.submission.reviewEvents.length, 1);
  assert.ok(response.submission.reviewDueAt);
});

test("RATE_REVIEW rejects a submission that is no longer in the study queue", async () => {
  globalThis.chrome = createChromeMock({
    local: { submissions: [], leetrepoSessionToken: "token" },
    sync: { settings: onboardedSettings }
  });
  await assert.rejects(
    () => handle({ type: "RATE_REVIEW", id: "missing", rating: "good" }),
    /no longer in your study queue/
  );
});

test("RATE_REVIEW is blocked while spaced repetition is turned off", async () => {
  globalThis.chrome = createChromeMock({
    local: { submissions: [{ id: "1-two-sum" }], leetrepoSessionToken: "token" },
    sync: { settings: { ...onboardedSettings, spacedRepetition: false } }
  });
  await assert.rejects(
    () => handle({ type: "RATE_REVIEW", id: "1-two-sum", rating: "good" }),
    /Turn on spaced repetition/
  );
});

test("RATE_REVIEW requires GitHub onboarding to be finished", async () => {
  globalThis.chrome = createChromeMock({
    local: { submissions: [{ id: "1-two-sum" }] },
    sync: { settings: { spacedRepetition: true } }
  });
  await assert.rejects(
    () => handle({ type: "RATE_REVIEW", id: "1-two-sum", rating: "good" }),
    /Finish GitHub setup first/
  );
});

test("an unknown message type is rejected", async () => {
  globalThis.chrome = createChromeMock();
  await assert.rejects(() => handle({ type: "NOT_A_REAL_MESSAGE" }), /Unknown message/);
});

test("OPEN_DASHBOARD deep-links onboarded users into the requested view", async () => {
  const mock = createChromeMock({
    local: { leetrepoSessionToken: "token" },
    sync: { settings: onboardedSettings }
  });
  globalThis.chrome = mock;
  await handle({ type: "OPEN_DASHBOARD", view: "study" });
  assert.equal(mock.createdTabs[0], "chrome-extension://mock/src/pages/dashboard/dashboard.html?view=study");
});

test("OPEN_DASHBOARD ignores the requested view for users who have not finished onboarding", async () => {
  const mock = createChromeMock({ sync: { settings: {} } });
  globalThis.chrome = mock;
  await handle({ type: "OPEN_DASHBOARD", view: "study" });
  assert.equal(mock.createdTabs[0], "chrome-extension://mock/src/pages/onboarding/onboarding.html");
});
