import { buildReadme, folderFor, formatCommit, normalizeSubmission } from "./submissions.js";

const API = "https://api.github.com";

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

export async function repoInfo(token, owner, repo) {
  return request(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
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

export async function pushSubmission({ token, settings, submission, review }) {
  const item = normalizeSubmission(submission);
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
  const parentCommit = await request(token, `/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const folder = folderFor(item);
  const solution = await createBlob(token, owner, repo, `${item.code}\n`);
  const entries = [{ path: `${folder}/solution.${item.extension}`, mode: "100644", type: "blob", sha: solution.sha }];
  if (settings.includeReadme !== false) {
    const readme = await createBlob(token, owner, repo, buildReadme(item, settings, review));
    entries.push({ path: `${folder}/README.md`, mode: "100644", type: "blob", sha: readme.sha });
  }
  const tree = await request(token, `/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: entries })
  });
  const commit = await request(token, `/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: formatCommit(settings.commitTemplate, item),
      tree: tree.sha,
      parents: [parentSha]
    })
  });
  await request(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return { sha: commit.sha, url: `https://github.com/${settings.owner}/${settings.repo}/commit/${commit.sha}`, branch };
}
