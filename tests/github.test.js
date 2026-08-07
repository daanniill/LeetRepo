import test from "node:test";
import assert from "node:assert/strict";
import { createRepo, listSolutionFolders, pushSubmission } from "../src/core/github.js";

test("createRepo sends the selected visibility without auto-initializing", async (t) => {
  let call;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    call = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ name: "leetcode-solutions", default_branch: "main" }), { status: 201, headers: { "content-type": "application/json" } });
  });
  await createRepo("secret", { name: "leetcode-solutions", visibility: "public" });
  assert.equal(call.url, "https://api.github.com/user/repos");
  assert.equal(call.init.method, "POST");
  assert.equal(call.body.private, false);
  assert.equal(call.body.auto_init, false);
});

test("listSolutionFolders imports only LeetRepo solution paths", async (t) => {
  const replies = [
    { default_branch: "main" },
    { tree: [
      { type: "blob", path: "0001-two-sum/solution.py" },
      { type: "blob", path: "0001-two-sum/README.md" },
      { type: "blob", path: "notes.txt" }
    ] }
  ];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(replies[calls++]), { status: 200, headers: { "content-type": "application/json" } }));
  const items = await listSolutionFolders("secret", "alex-c", "solutions");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Two Sum");
  assert.equal(items[0].language, "Python3");
});

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

test("pushSubmission initializes an empty repository before committing the solution", async (t) => {
  const calls = [];
  const replies = [
    { status: 200, body: { default_branch: "main" } },
    { status: 409, body: { message: "Git Repository is empty." } },
    { status: 201, body: { commit: { sha: "initial-commit" } } },
    { status: 200, body: { tree: { sha: "initial-tree" } } },
    { status: 200, body: { sha: "solution-blob" } },
    { status: 200, body: { sha: "readme-blob" } },
    { status: 200, body: { sha: "new-tree" } },
    { status: 200, body: { sha: "solution-commit" } },
    { status: 200, body: {} }
  ];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const reply = replies[calls.length];
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" }
    });
  });

  const result = await pushSubmission({
    token: "secret",
    settings: {
      owner: "alex-c",
      repo: "empty-solutions",
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

  assert.equal(calls[2].url, "https://api.github.com/repos/alex-c/empty-solutions/contents/README.md");
  assert.equal(calls[2].init.method, "PUT");
  assert.equal(calls[2].body.message, "chore: initialize repository for LeetRepo");
  assert.equal(calls[3].url, "https://api.github.com/repos/alex-c/empty-solutions/git/commits/initial-commit");
  assert.deepEqual(calls[6].body.tree.map((entry) => entry.path), ["0001-two-sum/solution.py", "0001-two-sum/README.md"]);
  assert.deepEqual(calls[7].body.parents, ["initial-commit"]);
  assert.equal(result.sha, "solution-commit");
  assert.equal(result.branch, "main");
});

test("pushSubmission can atomically refresh the generated profile README", async (t) => {
  const calls = [];
  const replies = [
    { default_branch: "main" },
    { object: { sha: "parent-sha" } },
    { tree: { sha: "parent-tree" } },
    { sha: "solution-blob" },
    { sha: "problem-readme-blob" },
    { sha: "profile-readme-blob" },
    { sha: "new-tree" },
    { sha: "new-commit" },
    {}
  ];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(replies[calls.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
  });
  await pushSubmission({
    token: "secret",
    settings: { owner: "alex-c", repo: "solutions", branch: "main", includeReadme: true, includeProfile: true },
    submission: { number: 1, title: "Two Sum", difficulty: "Easy", language: "Python3", code: "return [0, 1]" },
    profileItems: []
  });
  assert.deepEqual(calls[6].body.tree.map((entry) => entry.path), ["0001-two-sum/solution.py", "0001-two-sum/README.md", "README.md"]);
});
