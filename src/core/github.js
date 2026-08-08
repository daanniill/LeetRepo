import { buildProfileReadme, buildReadme, folderFor, formatCommit, languageFolderFor, normalizeSubmission, sameProblem } from "./submissions.js";

const API = "https://api.github.com";
const OAUTH = "https://github.com/login";
const MAX_BRANCH_UPDATE_ATTEMPTS = 3;

function oauthError(data, fallback) {
  const messages = {
    access_denied: "GitHub sign-in was cancelled.",
    device_flow_disabled: "Device flow is not enabled for this GitHub OAuth app.",
    expired_token: "The GitHub sign-in code expired. Start again to get a new code.",
    incorrect_client_credentials: "The configured GitHub OAuth client ID is invalid.",
    incorrect_device_code: "The GitHub sign-in code is no longer valid.",
    token_expired: "The GitHub sign-in code expired. Start again to get a new code.",
    unsupported_grant_type: "GitHub rejected the device authorization request."
  };
  return new Error(messages[data?.error] || data?.error_description || fallback);
}

async function oauthRequest(path, params) {
  const response = await fetch(`${OAUTH}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params).toString()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw oauthError(data, `GitHub sign-in failed (${response.status}).`);
  return data;
}

export async function startDeviceAuthorization(clientId, scope = "repo") {
  const data = await oauthRequest("/device/code", { client_id: clientId, scope });
  if (data.error) throw oauthError(data, "GitHub could not start sign-in.");
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error("GitHub returned an incomplete sign-in response.");
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: Number(data.expires_in) || 900,
    interval: Math.max(1, Number(data.interval) || 5)
  };
}

export async function pollDeviceAuthorization(clientId, deviceCode) {
  const data = await oauthRequest("/oauth/access_token", {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code"
  });
  if (data.access_token) {
    return {
      status: "authorized",
      accessToken: data.access_token,
      scope: data.scope || "",
      tokenType: data.token_type || "bearer"
    };
  }
  if (data.error === "authorization_pending") return { status: "pending" };
  if (data.error === "slow_down") return { status: "pending", slowDown: true };
  throw oauthError(data, "GitHub could not complete sign-in.");
}

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
}

async function request(token, path, init = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(token), ...init.headers } });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || `GitHub request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function verifyToken(token) {
  return request(token, "/user");
}

export async function listRepos(token) {
  return request(token, "/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member");
}

export async function createRepo(token, { name, description = "LeetCode solutions synced by LeetRepo", visibility = "private" }) {
  const repoName = String(name || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(repoName)) throw new Error("Repository names may contain letters, numbers, periods, underscores, and hyphens.");
  return request(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: repoName,
      description: String(description || "").trim().slice(0, 350),
      private: visibility !== "public",
      auto_init: false
    })
  });
}

export async function repoInfo(token, owner, repo) {
  return request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}

export async function listSolutionFolders(token, owner, repo, branch = "") {
  const info = await repoInfo(token, owner, repo);
  const selectedBranch = branch || info.default_branch || "main";
  const tree = await request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(selectedBranch)}?recursive=1`);
  if (tree.truncated) throw new Error("This repository is too large to backfill safely in one request.");
  const languages = { py: "Python3", cpp: "C++", java: "Java", js: "JavaScript", ts: "TypeScript", go: "Go", rs: "Rust", cs: "C#", kt: "Kotlin", swift: "Swift", rb: "Ruby", php: "PHP" };
  return (tree.tree || []).flatMap((entry) => {
    const match = entry.type === "blob" && entry.path.match(/^(\d{4,})-([^/]+)\/(?:(?:([^/]+)\/)?solution\.([A-Za-z0-9]+))$/);
    if (!match) return [];
    const [, number, slug, languageFolder, extension] = match;
    return [{
      number: String(Number(number)),
      title: slug.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : "").join(" "),
      slug,
      difficulty: "Unknown",
      language: languages[extension.toLowerCase()] || extension.toUpperCase(),
      extension,
      status: "Accepted",
      commitUrl: `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(selectedBranch)}/${number}-${slug}${languageFolder ? `/${encodeURIComponent(languageFolder)}` : ""}`
    }];
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
