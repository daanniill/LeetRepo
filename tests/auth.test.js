import test from "node:test";
import assert from "node:assert/strict";
import { clearDeviceAuthentication, hasCompletedOnboarding, settingsForSync } from "../src/core/auth.js";

test("onboarding derives connection from this device's session and the configured repository", () => {
  const configured = { connected: true, owner: "alex-c", repo: "leetcode-solutions" };
  assert.equal(hasCompletedOnboarding(configured, "session-token"), true);
  assert.equal(hasCompletedOnboarding(configured, ""), false);
  assert.equal(hasCompletedOnboarding({ ...configured, connected: false }, "session-token"), true);
  assert.equal(hasCompletedOnboarding({ ...configured, owner: "" }, "session-token"), false);
  assert.equal(hasCompletedOnboarding({ ...configured, repo: "" }, "session-token"), false);
});

test("device authentication state is never written to synchronized settings", () => {
  assert.deepEqual(
    settingsForSync({ connected: true, owner: "alex-c", repo: "leetcode-solutions", autoPush: true }),
    { owner: "alex-c", repo: "leetcode-solutions", autoPush: true }
  );
});

test("signing out clears authentication only on the current device", async () => {
  const removed = [];
  const storage = {
    local: { async remove(keys) { removed.push(...keys); } },
    sync: { async clear() { throw new Error("synchronized state must not be cleared"); } }
  };

  await clearDeviceAuthentication(storage);

  assert.ok(removed.includes("leetrepoSessionToken"));
  assert.ok(removed.includes("githubAccessToken"));
});
