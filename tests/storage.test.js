import test from "node:test";
import assert from "node:assert/strict";
import { clearLeetRepoStorage } from "../src/core/storage.js";

test("account deletion clears every extension storage area", async () => {
  const cleared = [];
  const area = (name) => ({ async clear() { cleared.push(name); } });
  await clearLeetRepoStorage({
    local: area("local"),
    sync: area("sync"),
    session: area("session")
  });
  assert.deepEqual(cleared.sort(), ["local", "session", "sync"]);
});
