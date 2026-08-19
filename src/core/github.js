import { buildProfileReadme, buildReadme, folderFor, formatCommit, languageFolderFor, normalizeSubmission, sameProblem } from "./submissions.js";
import { assertSafeGitHubAppPermissions } from "./github-permissions.js";

const API = "https://api.github.com";
const MAX_BRANCH_UPDATE_ATTEMPTS = 3;
const GITHUB_API_VERSION = "2026-03-10";
const GITHUB_TIMEOUT_MS = 20_000;

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "Content-Type": "application/json"
  };
}

async function request(token, path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...headers(token), ...init.headers },
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("GitHub took too long to respond. Try again shortly.");
    throw new Error("GitHub could not be reached. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || `GitHub request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function listRepos(token) {
  const installations = await request(token, "/user/installations?per_page=100");
  assertSafeGitHubAppPermissions(installations.installations);
  const repositories = [];
  for (const installation of installations.installations || []) {
    let page = 1;
    while (page <= 10) {
      const result = await request(token, `/user/installations/${installation.id}/repositories?per_page=100&page=${page}`);
      repositories.push(...(result.repositories || []));
      if ((result.repositories || []).length < 100) break;
      page += 1;
    }
  }
  return [...new Map(repositories.map((repo) => [repo.id, repo])).values()]
    .sort((left, right) => left.full_name.localeCompare(right.full_name));
}

export async function repoInfo(token, owner, repo) {
  return request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}

export async function listSolutionFolders(token, owner, repo, branch = "") {
  const info = await repoInfo(token, owner, repo);
  const selectedBranch = branch || info.default_branch || "main";
  const tree = await request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(selectedBranch)}?recursive=1`);
  if (tree.truncated) throw new Error("This repository is too large to backfill safely in one request.");
  const languages = {
    bash: "Bash", sh: "Bash", c: "C", cpp: "C++", csharp: "C#", cs: "C#", dart: "Dart", elixir: "Elixir", ex: "Elixir",
    erlang: "Erlang", erl: "Erlang", go: "Go", java: "Java", javascript: "JavaScript", js: "JavaScript", kotlin: "Kotlin", kt: "Kotlin",
    mysql: "MySQL", sql: "SQL", php: "PHP", python: "Python3", python3: "Python3", py: "Python3", racket: "Racket", rkt: "Racket",
    ruby: "Ruby", rb: "Ruby", rust: "Rust", rs: "Rust", scala: "Scala", swift: "Swift", typescript: "TypeScript", ts: "TypeScript"
  };
  const solutions = (tree.tree || []).flatMap((entry) => {
    const match = entry.type === "blob" && entry.path.match(/^(\d{4,})-([^/]+)\/(?:(?:([^/]+)\/)?solution\.([A-Za-z0-9]+))$/);
    if (!match) return [];
    const [, number, slug, languageFolder, extension] = match;
    return [{
      number: String(Number(number)),
      title: slug.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : "").join(" "),
      slug,
      difficulty: "Unknown",
      language: languages[languageFolder?.toLowerCase()] || languages[extension.toLowerCase()] || extension.toUpperCase(),
      extension: extension.toLowerCase(),
      path: entry.path,
      status: "Accepted",
      commitUrl: `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(selectedBranch)}/${number}-${slug}${languageFolder ? `/${encodeURIComponent(languageFolder)}` : ""}`
    }];
  });
  const grouped = new Map();
  for (const solution of solutions) {
    const key = solution.number;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(solution);
  }
  for (let index = 0; index < solutions.length; index += 10) {
    await Promise.all(solutions.slice(index, index + 10).map(async (solution) => {
      const commits = await request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(selectedBranch)}&path=${encodeURIComponent(solution.path)}&per_page=1`);
      const latest = commits[0];
      solution.syncedAt = latest?.commit?.committer?.date || latest?.commit?.author?.date || null;
      solution.commitSha = latest?.sha || "";
    }));
  }
  return [...grouped.values()].map((items) => {
    const variants = items.slice().sort((left, right) => {
      const dateDifference = (Date.parse(right.syncedAt) || 0) - (Date.parse(left.syncedAt) || 0);
      return dateDifference || left.path.localeCompare(right.path);
    });
    const latest = variants[0];
    return { ...latest, solutions: variants };
  });
}

async function createBlob(token, owner, repo, content) {
  return request(token, `/repos/${owner}/${repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding: "utf-8" })
  });
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function initializeEmptyRepo(token, owner, repo) {
  return request(token, `/repos/${owner}/${repo}/contents/README.md`, {
    method: "PUT",
    body: JSON.stringify({
      message: "chore: initialize repository for LeetRepo",
      content: base64Utf8("# LeetCode Solutions\n\nAccepted solutions synced by LeetRepo.\n")
    })
  });
}

function isEmptyRepoError(error) {
  return error?.status === 409 && /repository is empty/i.test(error.message);
}

function isNonFastForwardError(error) {
  return error?.status === 422 && /not a fast[- ]forward/i.test(error.message);
}

async function repositoryTree(token, owner, repo, treeSha) {
  const tree = await request(token, `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`);
  if (tree.truncated) throw new Error("This repository is too large to verify a safe solution update.");
  return tree.tree || [];
}

function assertTreePreserved(previousEntries, nextEntries, additions) {
  const nextByPath = new Map(nextEntries.filter((entry) => entry.type !== "tree").map((entry) => [entry.path, entry]));
  const additionsByPath = new Map(additions.map((entry) => [entry.path, entry]));
  for (const previous of previousEntries.filter((entry) => entry.type !== "tree")) {
    const expectedSha = additionsByPath.get(previous.path)?.sha || previous.sha;
    if (nextByPath.get(previous.path)?.sha !== expectedSha) {
      throw new Error("Safety check failed because the proposed commit did not preserve every existing repository file. The branch was not updated.");
    }
  }
  for (const addition of additions) {
    if (nextByPath.get(addition.path)?.sha !== addition.sha) {
      throw new Error("Safety check failed because the proposed commit was missing a generated solution file. The branch was not updated.");
    }
  }
}

function treeContainsEntries(tree, entries) {
  const byPath = new Map(tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
  return entries.every((entry) => byPath.get(entry.path) === entry.sha);
}

export async function pushSubmission({ token, settings, submission, review, profileItems = [] }) {
  const pushedAt = submission.syncedAt || new Date().toISOString();
  const item = normalizeSubmission({ ...submission, solvedAt: submission.solvedAt || pushedAt, syncedAt: pushedAt });
  if (!item.code) throw new Error("No solution code was found on this page.");
  const owner = encodeURIComponent(settings.owner);
  const repo = encodeURIComponent(settings.repo);
  const info = await repoInfo(token, settings.owner, settings.repo);
  let branch = settings.branch || info.default_branch || "main";
  let parentSha;
  try {
    const ref = await request(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    parentSha = ref.object.sha;
  } catch (error) {
    if (!isEmptyRepoError(error)) throw error;
    const initialized = await initializeEmptyRepo(token, owner, repo);
    branch = info.default_branch || "main";
    parentSha = initialized.commit.sha;
  }
  let parentCommit = await request(token, `/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const folder = folderFor(item);
  const languageFolder = languageFolderFor(item);
  let previousTree = await repositoryTree(token, owner, repo, parentCommit.tree.sha);
  const solutionPath = `${folder}/${languageFolder}/solution.${item.extension}`;
  const readmePath = `${folder}/README.md`;
  const solution = await createBlob(token, owner, repo, `${item.code}\n`);
  const entries = [{ path: solutionPath, mode: "100644", type: "blob", sha: solution.sha }];
  if (settings.includeReadme !== false) {
    const readme = await createBlob(token, owner, repo, buildReadme(item, settings, review));
    entries.push({ path: readmePath, mode: "100644", type: "blob", sha: readme.sha });
  }
  if (settings.includeProfile === true) {
    const history = [
      { ...item, syncedAt: item.syncedAt || new Date().toISOString(), review: review || item.review },
      ...profileItems.filter((existing) => !sameProblem(existing, item))
    ];
    const profile = await createBlob(token, owner, repo, buildProfileReadme(history, settings));
    entries.push({ path: "README.md", mode: "100644", type: "blob", sha: profile.sha });
  }
  for (let attempt = 1; ; attempt += 1) {
    const updatesExistingSolution = previousTree.some((entry) => entry.type === "blob" && entry.path === solutionPath);
    if (treeContainsEntries(previousTree, entries)) {
      return {
        sha: parentSha,
        url: `https://github.com/${settings.owner}/${settings.repo}/commit/${parentSha}`,
        branch,
        updated: updatesExistingSolution
      };
    }
    const tree = await request(token, `/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: entries })
    });
    const proposedTree = await repositoryTree(token, owner, repo, tree.sha);
    assertTreePreserved(previousTree, proposedTree, entries);
    const commit = await request(token, `/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: formatCommit(settings.commitTemplate, item),
        tree: tree.sha,
        parents: [parentSha]
      })
    });
    try {
      await request(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false })
      });
      return {
        sha: commit.sha,
        url: `https://github.com/${settings.owner}/${settings.repo}/commit/${commit.sha}`,
        branch,
        updated: updatesExistingSolution
      };
    } catch (error) {
      if (!isNonFastForwardError(error) || attempt >= MAX_BRANCH_UPDATE_ATTEMPTS) throw error;
      const ref = await request(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
      parentSha = ref.object.sha;
      parentCommit = await request(token, `/repos/${owner}/${repo}/git/commits/${parentSha}`);
      previousTree = await repositoryTree(token, owner, repo, parentCommit.tree.sha);
    }
  }
}
