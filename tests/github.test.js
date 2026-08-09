import test from "node:test";
import assert from "node:assert/strict";
import { listRepos, listSolutionFolders, pushSubmission } from "../src/core/github.js";

test("listRepos returns only repositories selected for GitHub App installations", async (t) => {
  const replies = [
    { installations: [{ id: 22 }, { id: 33 }] },
    { repositories: [{ id: 2, full_name: "alex-c/private-solutions" }] },
    { repositories: [
      { id: 1, full_name: "alex-c/leetcode-solutions" },
      { id: 2, full_name: "alex-c/private-solutions" }
    ] }
  ];
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(replies[calls.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
  });
  const repos = await listRepos("user-access-token");
  assert.deepEqual(repos.map((repo) => repo.full_name), ["alex-c/leetcode-solutions", "alex-c/private-solutions"]);
  assert.match(calls[0], /\/user\/installations\?per_page=100$/);
  assert.match(calls[1], /\/user\/installations\/22\/repositories/);
});

test("listRepos rejects a GitHub App with repository administration access", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({
      installations: [{ id: 22, permissions: { contents: "write", administration: "write" } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  await assert.rejects(listRepos("user-access-token"), /must not request Repository administration permission/);
  assert.equal(calls.length, 1);
});

test("listSolutionFolders imports legacy and language-folder solution paths", async (t) => {
  const replies = [
    { default_branch: "main" },
    { tree: [
      { type: "blob", path: "0001-two-sum/solution.py" },
      { type: "blob", path: "0001-two-sum/README.md" },
      { type: "blob", path: "0001-two-sum/cpp/solution.cpp" },
      { type: "blob", path: "notes.txt" }
    ] },
    [{ sha: "python-commit", commit: { committer: { date: "2026-08-01T10:00:00.000Z" } } }],
    [{ sha: "cpp-commit", commit: { committer: { date: "2026-08-07T10:00:00.000Z" } } }]
  ];
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(replies[calls.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
  });
  const items = await listSolutionFolders("secret", "alex-c", "solutions");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Two Sum");
  assert.equal(items[0].language, "C++");
  assert.equal(items[0].syncedAt, "2026-08-07T10:00:00.000Z");
  assert.deepEqual(items[0].solutions.map((solution) => solution.language), ["C++", "Python3"]);
  assert.equal(items[0].solutions[0].commitUrl, "https://github.com/alex-c/solutions/tree/main/0001-two-sum/cpp");
  assert.match(calls[2], /path=0001-two-sum%2Fsolution.py/);
  assert.match(calls[3], /path=0001-two-sum%2Fcpp%2Fsolution.cpp/);
});

test("pushSubmission builds one tree and advances one branch ref", async (t) => {
  const calls = [];
  const replies = [
    { default_branch: "main" },
    { object: { sha: "parent-sha" } },
    { tree: { sha: "parent-tree" } },
    { tree: [] },
    { sha: "solution-blob" },
    { sha: "readme-blob" },
    { sha: "new-tree" },
    { tree: [
      { type: "blob", path: "0001-two-sum/python/solution.py", sha: "solution-blob" },
      { type: "blob", path: "0001-two-sum/README.md", sha: "readme-blob" }
    ] },
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

  assert.equal(calls.length, 10);
  assert.equal(calls.filter((call) => call.url.endsWith("/git/commits") && call.init.method === "POST").length, 1);
  assert.equal(calls[3].url, "https://api.github.com/repos/alex-c/solutions/git/trees/parent-tree?recursive=1");
  assert.deepEqual(calls[6].body.tree.map((entry) => entry.path), ["0001-two-sum/python/solution.py", "0001-two-sum/README.md"]);
  assert.equal(calls[8].body.message, "solve: 1. Two Sum");
  assert.deepEqual(calls[8].body.parents, ["parent-sha"]);
  assert.equal(calls[9].init.method, "PATCH");
  assert.equal(calls[9].body.sha, "new-commit");
  assert.equal(result.url, "https://github.com/alex-c/solutions/commit/new-commit");
  assert.equal(result.updated, false);
});

test("pushSubmission initializes an empty repository before committing the solution", async (t) => {
  const calls = [];
  const replies = [
    { status: 200, body: { default_branch: "main" } },
    { status: 409, body: { message: "Git Repository is empty." } },
    { status: 201, body: { commit: { sha: "initial-commit" } } },
    { status: 200, body: { tree: { sha: "initial-tree" } } },
    { status: 200, body: { tree: [] } },
    { status: 200, body: { sha: "solution-blob" } },
    { status: 200, body: { sha: "readme-blob" } },
    { status: 200, body: { sha: "new-tree" } },
    { status: 200, body: { tree: [
      { type: "blob", path: "0001-two-sum/python/solution.py", sha: "solution-blob" },
      { type: "blob", path: "0001-two-sum/README.md", sha: "readme-blob" }
    ] } },
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
  assert.deepEqual(calls[7].body.tree.map((entry) => entry.path), ["0001-two-sum/python/solution.py", "0001-two-sum/README.md"]);
  assert.deepEqual(calls[9].body.parents, ["initial-commit"]);
  assert.equal(result.sha, "solution-commit");
  assert.equal(result.branch, "main");
});

test("pushSubmission can atomically refresh the generated profile README", async (t) => {
  const calls = [];
  const replies = [
    { default_branch: "main" },
    { object: { sha: "parent-sha" } },
    { tree: { sha: "parent-tree" } },
    { tree: [] },
    { sha: "solution-blob" },
    { sha: "problem-readme-blob" },
    { sha: "profile-readme-blob" },
    { sha: "new-tree" },
    { tree: [
      { type: "blob", path: "0001-two-sum/python/solution.py", sha: "solution-blob" },
      { type: "blob", path: "0001-two-sum/README.md", sha: "problem-readme-blob" },
      { type: "blob", path: "README.md", sha: "profile-readme-blob" }
    ] },
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
  assert.deepEqual(calls[7].body.tree.map((entry) => entry.path), ["0001-two-sum/python/solution.py", "0001-two-sum/README.md", "README.md"]);
});

test("pushSubmission updates only the existing language folder without deleting repository files", async (t) => {
  const calls = [];
  const replies = [
    { default_branch: "main" },
    { object: { sha: "parent-sha" } },
    { tree: { sha: "parent-tree" } },
    { tree: [
      { type: "blob", path: "0001-two-sum/cpp/solution.cpp", sha: "cpp-solution" },
      { type: "blob", path: "0001-two-sum/python/solution.py", sha: "old-python-solution" },
      { type: "blob", path: "0001-two-sum/README.md", sha: "old-readme" },
      { type: "blob", path: "0002-add-two-numbers/solution.py", sha: "other-solution" }
    ] },
    { sha: "solution-blob" },
    { sha: "readme-blob" },
    { sha: "new-tree" },
    { tree: [
      { type: "blob", path: "0001-two-sum/cpp/solution.cpp", sha: "cpp-solution" },
      { type: "blob", path: "0001-two-sum/python/solution.py", sha: "solution-blob" },
      { type: "blob", path: "0001-two-sum/README.md", sha: "readme-blob" },
      { type: "blob", path: "0002-add-two-numbers/solution.py", sha: "other-solution" },
    ] },
    { sha: "new-commit" },
    {}
  ];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(replies[calls.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await pushSubmission({
    token: "secret",
    settings: { owner: "alex-c", repo: "solutions", branch: "main", includeReadme: true },
    submission: {
      number: 1,
      title: "Two Sum",
      slug: "two-sum",
      language: "Python3",
      code: "return [0, 1]",
      solvedAt: "2026-08-07T12:34:56.000Z"
    }
  });

  assert.deepEqual(calls[6].body.tree, [
    { path: "0001-two-sum/python/solution.py", mode: "100644", type: "blob", sha: "solution-blob" },
    { path: "0001-two-sum/README.md", mode: "100644", type: "blob", sha: "readme-blob" }
  ]);
  assert.match(calls[5].body.content, /\*\*Solved:\*\* 2026-08-07 12:34 UTC/);
  assert.equal(result.updated, true);
});

test("pushSubmission retries on a non-fast-forward branch update", async (t) => {
  const calls = [];
  const replies = [
    { status: 200, body: { default_branch: "main" } },
    { status: 200, body: { object: { sha: "original-parent" } } },
    { status: 200, body: { tree: { sha: "original-tree" } } },
    { status: 200, body: { tree: [] } },
    { status: 200, body: { sha: "solution-blob" } },
    { status: 200, body: { sha: "readme-blob" } },
    { status: 200, body: { sha: "first-tree" } },
    { status: 200, body: { tree: [
      { type: "blob", path: "0001-two-sum/python/solution.py", sha: "solution-blob" },
      { type: "blob", path: "0001-two-sum/README.md", sha: "readme-blob" }
    ] } },
    { status: 200, body: { sha: "first-commit" } },
    { status: 422, body: { message: "Update is not a fast forward" } },
    { status: 200, body: { object: { sha: "current-parent" } } },
    { status: 200, body: { tree: { sha: "current-tree" } } },
    { status: 200, body: { tree: [
      { type: "blob", path: "notes.txt", sha: "competing-file" }
    ] } },
    { status: 200, body: { sha: "rebased-tree" } },
    { status: 200, body: { tree: [
      { type: "blob", path: "notes.txt", sha: "competing-file" },
      { type: "blob", path: "0001-two-sum/python/solution.py", sha: "solution-blob" },
      { type: "blob", path: "0001-two-sum/README.md", sha: "readme-blob" }
    ] } },
    { status: 200, body: { sha: "rebased-commit" } },
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
    settings: { owner: "alex-c", repo: "solutions", branch: "main", includeReadme: true },
    submission: { number: 1, title: "Two Sum", language: "Python3", code: "return [0, 1]" }
  });

  assert.deepEqual(calls[8].body.parents, ["original-parent"]);
  assert.deepEqual(calls[15].body.parents, ["current-parent"]);
  assert.equal(calls[9].body.force, false);
  assert.equal(calls[16].body.force, false);
  assert.equal(result.sha, "rebased-commit");
});

test("pushSubmission aborts before moving the branch if the proposed tree loses a file", async (t) => {
  const calls = [];
  const replies = [
    { default_branch: "main" },
    { object: { sha: "parent-sha" } },
    { tree: { sha: "parent-tree" } },
    { tree: [{ type: "blob", path: "0002-add-two-numbers/solution.py", sha: "must-survive" }] },
    { sha: "solution-blob" },
    { sha: "readme-blob" },
    { sha: "unsafe-tree" },
    { tree: [
      { type: "blob", path: "0001-two-sum/python/solution.py", sha: "solution-blob" },
      { type: "blob", path: "0001-two-sum/README.md", sha: "readme-blob" }
    ] }
  ];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(replies[calls.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
  });

  await assert.rejects(pushSubmission({
    token: "secret",
    settings: { owner: "alex-c", repo: "solutions", branch: "main", includeReadme: true },
    submission: { number: 1, title: "Two Sum", language: "Python3", code: "return [0, 1]" }
  }), /did not preserve every existing repository file/);
  assert.equal(calls.some((call) => call.url.endsWith("/git/commits") && call.init.method === "POST"), false);
  assert.equal(calls.some((call) => call.url.includes("/git/refs/heads/") && call.init.method === "PATCH"), false);
});
