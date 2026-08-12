import test from "node:test";
import assert from "node:assert/strict";
import { hasCompletedOnboarding } from "../src/core/auth.js";

test("onboarding requires a local GitHub token and configured repository", () => {
  const configured = { connected: true, owner: "alex-c", repo: "leetcode-solutions" };
  assert.equal(hasCompletedOnboarding(configured, "github-token"), true);
  assert.equal(hasCompletedOnboarding(configured, ""), false);
  assert.equal(hasCompletedOnboarding({ ...configured, connected: false }, "github-token"), false);
  assert.equal(hasCompletedOnboarding({ ...configured, owner: "" }, "github-token"), false);
  assert.equal(hasCompletedOnboarding({ ...configured, repo: "" }, "github-token"), false);
});
