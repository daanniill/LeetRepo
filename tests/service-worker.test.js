import test from "node:test";
import assert from "node:assert/strict";
import { buildReadme, parseReadmeData } from "../src/core/submissions.js";

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

function repositoryAuth(submissions = []) {
  return {
    submissions,
    leetrepoSessionToken: "token",
    githubAccessToken: "github-token",
    githubAccessTokenExpiresAt: "2999-01-01T00:00:00.000Z"
  };
}

function mockRepository(t, item) {
  const initialReadme = buildReadme(item, { aiEnabled: Boolean(item.review?.generatedBy) }, item.review);
  let proposedEntries = [];
  let writtenReadme = "";
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const target = new URL(url);
    if (target.origin === "https://leetrepo.onrender.com") {
      const usage = {
        plan: "free",
        daily: { requests: 0, inputTokens: 0, outputTokens: 0, limit: 3 },
        monthly: { requests: 0, inputTokens: 0, outputTokens: 0, limit: 30 }
      };
      const value = target.pathname === "/v1/ai/explanations"
        ? {
            review: {
              summary: "Use a hash map for complements.",
              approach: ["Scan once.", "Return the matching index."],
              complexity: { time: "O(n)", space: "O(n)" },
              generatedBy: "Groq"
            },
            usage,
            model: "test-model"
          }
        : usage;
      return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
    }
    const path = `${target.pathname}${target.search}`;
    const body = init.body ? JSON.parse(init.body) : null;
    let value;
    if (path === "/repos/alex-c/solutions") value = { default_branch: "main" };
    else if (path === "/repos/alex-c/solutions/git/trees/main?recursive=1") value = { tree: [
      { type: "blob", path: "0001-two-sum/python/solution.py", sha: "solution-sha" },
      { type: "blob", path: "0001-two-sum/README.md", sha: "readme-sha" }
    ] };
    else if (path === "/repos/alex-c/solutions/git/blobs/readme-sha") value = { encoding: "base64", content: Buffer.from(initialReadme, "utf8").toString("base64") };
    else if (path.includes("/commits?")) value = [{ sha: "original-commit", commit: { committer: { date: item.syncedAt } } }];
    else if (path === "/repos/alex-c/solutions/git/ref/heads/main") value = { object: { sha: "parent-sha" } };
    else if (path === "/repos/alex-c/solutions/git/commits/parent-sha") value = { tree: { sha: "parent-tree" } };
    else if (path === "/repos/alex-c/solutions/git/trees/parent-tree?recursive=1") value = { tree: [
      { type: "blob", path: "0001-two-sum/python/solution.py", sha: "solution-sha" },
      { type: "blob", path: "0001-two-sum/README.md", sha: "readme-sha" }
    ] };
    else if (path === "/repos/alex-c/solutions/git/blobs" && init.method === "POST") {
      if (body.content.includes("leetrepo:data:v1")) {
        writtenReadme = body.content;
        value = { sha: "new-readme-sha" };
      } else value = { sha: "solution-sha" };
    } else if (path === "/repos/alex-c/solutions/git/trees" && init.method === "POST") {
      proposedEntries = body.tree;
      value = { sha: "new-tree" };
    } else if (path === "/repos/alex-c/solutions/git/trees/new-tree?recursive=1") {
      value = { tree: proposedEntries };
    } else if (path === "/repos/alex-c/solutions/git/commits" && init.method === "POST") value = { sha: "new-commit" };
    else if (path === "/repos/alex-c/solutions/git/refs/heads/main" && init.method === "PATCH") value = {};
    else return new Response(JSON.stringify({ message: `Unexpected GitHub request: ${init.method || "GET"} ${path}` }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { written: () => parseReadmeData(writtenReadme) };
}

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
    { spacedRepetition: true, studyIntervalValue: 30, studyIntervalUnit: "days" },
    existing
  );
  assert.equal(item.reviewDueAt, "2026-09-01T00:00:00.000Z", "a resync must not reset an earned due date");
  assert.equal(item.reviewCount, 2);
  assert.deepEqual(item.reviewEvents, existing.reviewEvents);
});

test("PUSH_SUBMISSION preserves an earned review schedule and event history when re-pushing to GitHub", async (t) => {
  const existing = {
    id: "1-two-sum", number: "1", title: "Two Sum", slug: "two-sum", language: "Python3",
    code: "return [0, 1]", syncedAt: "2026-08-01T00:00:00.000Z",
    reviewCount: 2, reviewIntervalDays: 14, reviewDueAt: "2026-09-01T00:00:00.000Z",
    lastReviewedAt: "2026-08-18T00:00:00.000Z", lastReviewRating: "good",
    reviewEvents: [
      { ratedAt: "2026-08-01T00:00:00.000Z", rating: "hard", intervalDaysAfter: 3 },
      { ratedAt: "2026-08-18T00:00:00.000Z", rating: "good", intervalDaysAfter: 14 }
    ]
  };
  const repository = mockRepository(t, existing);
  globalThis.chrome = createChromeMock({
    local: repositoryAuth(),
    sync: { settings: onboardedSettings }
  });

  const response = await handle({
    type: "PUSH_SUBMISSION",
    submission: {
      number: "1", title: "Two Sum", slug: "two-sum", language: "Python3",
      code: "return [0, 1]  # tidied comment", status: "Accepted", pushReady: true
    }
  });

  assert.equal(response.submission.reviewDueAt, "2026-09-01T00:00:00.000Z", "re-pushing a solved problem must not reset an earned due date");
  assert.equal(response.submission.reviewCount, 2);
  assert.deepEqual(response.submission.reviewEvents, existing.reviewEvents);
  const written = repository.written();
  assert.equal(written.reviewDueAt, "2026-09-01T00:00:00.000Z", "the persisted GitHub README must also keep the earned due date");
  assert.equal(written.reviewCount, 2);
  assert.deepEqual(written.reviewEvents, existing.reviewEvents);
});

test("GET_STATE builds the dashboard library from GitHub READMEs instead of local solution records", async (t) => {
  const item = {
    id: "1-two-sum", number: "1", title: "Two Sum", slug: "two-sum", difficulty: "Easy",
    language: "Python3", code: "return [0, 1]", problemDescription: "Find the matching pair.",
    syncedAt: "2026-08-01T00:00:00.000Z"
  };
  mockRepository(t, item);
  const mock = createChromeMock({
    local: {
      ...repositoryAuth([{ number: "99", title: "Stale local solution", code: "stale" }]),
      attempts: [{ ...item, status: "Wrong Answer", code: "failed source", problemDescription: "copied problem", recordedAt: "2026-07-31T00:00:00.000Z" }]
    },
    sync: { settings: onboardedSettings }
  });
  globalThis.chrome = mock;

  const state = await handle({ type: "GET_STATE" });
  assert.equal(state.submissions.length, 1);
  assert.equal(state.submissions[0].title, "Two Sum");
  assert.equal(state.submissions[0].code, "return [0, 1]");
  assert.equal(state.submissions[0].problemDescription, "Find the matching pair.");
  assert.equal(state.attempts[0].code, undefined);
  assert.equal(state.attempts[0].problemDescription, undefined);
  assert.equal((await mock.storage.local.get("submissions")).submissions[0].title, "Stale local solution", "legacy data is ignored rather than treated as canonical");
});

test("RATE_REVIEW advances the schedule and stores the event in the GitHub README", async (t) => {
  const repository = mockRepository(t, {
    id: "1-two-sum", number: "1", title: "Two Sum", slug: "two-sum", language: "Python3",
    code: "return [0, 1]", syncedAt: "2026-08-01T00:00:00.000Z", reviewCount: 0
  });
  globalThis.chrome = createChromeMock({
    local: repositoryAuth(),
    sync: { settings: onboardedSettings }
  });
  const response = await handle({ type: "RATE_REVIEW", id: "1-two-sum", rating: "good" });
  assert.equal(response.submission.reviewCount, 1);
  assert.equal(response.submission.lastReviewRating, "good");
  assert.equal(response.submission.reviewEvents.length, 1);
  assert.equal(repository.written().reviewCount, 1);
  assert.equal(repository.written().reviewEvents[0].rating, "good");
});

test("GENERATE_FEEDBACK commits hosted AI feedback to the tagged GitHub README", async (t) => {
  const item = {
    id: "1-two-sum", number: "1", title: "Two Sum", slug: "two-sum", language: "Python3",
    code: "return [0, 1]", syncedAt: "2026-08-01T00:00:00.000Z"
  };
  const repository = mockRepository(t, item);
  globalThis.chrome = createChromeMock({
    local: repositoryAuth(),
    sync: { settings: { ...onboardedSettings, aiEnabled: true, aiConsent: true } }
  });

  const response = await handle({ type: "GENERATE_FEEDBACK", submission: item });
  assert.equal(response.persisted, true);
  assert.equal(response.ai.generated, true);
  assert.equal(repository.written().review.summary, "Use a hash map for complements.");
  assert.equal(repository.written().review.generatedBy, "Groq");
});

test("SAVE_NOTES commits notes to the tagged GitHub README", async (t) => {
  const item = {
    id: "1-two-sum", number: "1", title: "Two Sum", slug: "two-sum", language: "Python3",
    code: "return [0, 1]", syncedAt: "2026-08-01T00:00:00.000Z"
  };
  const repository = mockRepository(t, item);
  globalThis.chrome = createChromeMock({
    local: repositoryAuth(),
    sync: { settings: onboardedSettings }
  });

  const response = await handle({ type: "SAVE_NOTES", submission: item, notes: "Watch duplicate values." });
  assert.equal(response.persisted, true);
  assert.equal(repository.written().notes, "Watch duplicate values.");
});

test("SNOOZE_REVIEW stores the due date without adding a review event", async (t) => {
  const repository = mockRepository(t, {
    id: "1-two-sum",
    number: "1",
    title: "Two Sum",
    slug: "two-sum",
    language: "Python3",
    code: "return [0, 1]",
    syncedAt: "2026-08-01T00:00:00.000Z",
    reviewCount: 1,
    reviewEvents: [{ ratedAt: "2026-08-01T00:00:00.000Z", rating: "good", intervalDaysAfter: 14 }]
  });
  globalThis.chrome = createChromeMock({
    local: repositoryAuth(),
    sync: { settings: onboardedSettings }
  });
  const response = await handle({ type: "SNOOZE_REVIEW", id: "1-two-sum" });
  assert.equal(response.submission.reviewCount, 1);
  assert.equal(response.submission.reviewEvents.length, 1);
  assert.ok(response.submission.reviewDueAt);
  assert.equal(repository.written().reviewEvents.length, 1);
  assert.equal(repository.written().reviewDueAt, response.submission.reviewDueAt);
});

test("RATE_REVIEW rejects a submission that is no longer in the GitHub-backed study queue", async (t) => {
  mockRepository(t, {
    id: "1-two-sum", number: "1", title: "Two Sum", slug: "two-sum", language: "Python3",
    code: "return [0, 1]", syncedAt: "2026-08-01T00:00:00.000Z"
  });
  globalThis.chrome = createChromeMock({
    local: repositoryAuth(),
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
