import test from "node:test";
import assert from "node:assert/strict";
import { pushSubmission } from "../src/github.js";

test("pushSubmission builds one tree and advances one branch ref", async (t) => {
  const calls = [];
  const replies = [
    { default_branch: "main" },
    { object: { sha: "parent-sha" } },
    { tree: { sha: "parent-tree" } },
    { sha: "solution-blob" },
    { sha: "readme-blob" },
    { sha: "new-tree" },
    { sha: "new-commit" },
    {}
  ];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(replies[calls.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await pushSubmission({
    token: "secret",
    settings: {
      owner: "alex-c",
      repo: "solutions",
      branch: "main",
      includeReadme: true,
      commitTemplate: "solve: {number}. {title}"
    },
    submission: {
      number: 1,
      title: "Two Sum",
      difficulty: "Easy",
      language: "Python3",
      code: "return [0, 1]"
    }
  });

  assert.equal(calls.length, 8);
  assert.equal(calls.filter((call) => call.url.endsWith("/git/commits") && call.init.method === "POST").length, 1);
  assert.deepEqual(calls[5].body.tree.map((entry) => entry.path), ["0001-two-sum/solution.py", "0001-two-sum/README.md"]);
  assert.equal(calls[6].body.message, "solve: 1. Two Sum");
  assert.deepEqual(calls[6].body.parents, ["parent-sha"]);
  assert.equal(calls[7].init.method, "PATCH");
  assert.equal(calls[7].body.sha, "new-commit");
  assert.equal(result.url, "https://github.com/alex-c/solutions/commit/new-commit");
});
