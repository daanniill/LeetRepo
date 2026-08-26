import test from "node:test";
import assert from "node:assert/strict";
import { clearDeviceAuthentication, hasCompletedOnboarding, settingsForSync } from "../src/core/auth.js";

test("onboarding requires a local GitHub token and configured repository", () => {
  const configured = { connected: true, owner: "alex-c", repo: "leetcode-solutions" };
  assert.equal(hasCompletedOnboarding(configured, "github-token"), true);
  assert.equal(hasCompletedOnboarding(configured, ""), false);
  assert.equal(hasCompletedOnboarding({ ...configured, connected: false }, "github-token"), false);
  assert.equal(hasCompletedOnboarding({ ...configured, owner: "" }, "github-token"), false);
  assert.equal(hasCompletedOnboarding({ ...configured, repo: "" }, "github-token"), false);
});

test("a new client keeps older extension versions connected during rollout", () => {
  assert.deepEqual(
    settingsForSync({ connected: true, owner: "alex-c", repo: "leetcode-solutions", autoPush: true }),
    { connected: true, owner: "alex-c", repo: "leetcode-solutions", autoPush: true }
  );
  assert.equal(settingsForSync({ connected: false, autoPush: false }, { connected: true }).connected, true);
});

test("disconnecting clears direct GitHub authentication only on the current device", async () => {
  const removed = [];
  const storage = {
    local: { async remove(keys) { removed.push(...keys); } },
    sync: { async clear() { throw new Error("synchronized state must not be cleared"); } }
  };

  await clearDeviceAuthentication(storage);

  assert.ok(removed.includes("githubAccessToken"));
  assert.ok(removed.includes("githubUser"));
});
