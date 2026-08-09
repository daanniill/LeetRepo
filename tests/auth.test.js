import test from "node:test";
import assert from "node:assert/strict";
import { hasCompletedOnboarding } from "../src/core/auth.js";

test("onboarding requires a session and a configured installed repository", () => {
  const configured = { connected: true, owner: "alex-c", repo: "leetcode-solutions" };
  assert.equal(hasCompletedOnboarding(configured, "session-token"), true);
  assert.equal(hasCompletedOnboarding(configured, ""), false);
  assert.equal(hasCompletedOnboarding({ ...configured, connected: false }, "session-token"), false);
  assert.equal(hasCompletedOnboarding({ ...configured, owner: "" }, "session-token"), false);
  assert.equal(hasCompletedOnboarding({ ...configured, repo: "" }, "session-token"), false);
});
