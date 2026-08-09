import { Buffer } from "node:buffer";
import { HttpError } from "./errors.js";
import { assertSafeGitHubAppPermissions } from "../src/core/github-permissions.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_LOGIN = "https://github.com/login";

async function jsonResponse(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, "GITHUB_ERROR", data?.error_description || data?.message || fallback);
  return data;
}

function apiHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function githubApi(path, token, fetchImpl) {
  const response = await fetchImpl(`${GITHUB_API}${path}`, { headers: apiHeaders(token) });
  return jsonResponse(response, `GitHub request failed (${response.status}).`);
}

export async function exchangeAuthorizationCode({ code, clientId, clientSecret, redirectUri = "", fetchImpl = fetch }) {
  const values = { client_id: clientId, client_secret: clientSecret, code };
  if (redirectUri) values.redirect_uri = redirectUri;
  const response = await fetchImpl(`${GITHUB_LOGIN}/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString()
  });
  const data = await jsonResponse(response, "GitHub sign-in failed.");
  if (data.error) throw new HttpError(502, "GITHUB_OAUTH_ERROR", data.error_description || "GitHub sign-in failed.");
  if (!data.access_token) throw new HttpError(502, "GITHUB_TOKEN_MISSING", "GitHub did not return an access token.");
  return data;
}

export async function refreshUserAccessToken({ refreshToken, clientId, clientSecret, fetchImpl = fetch }) {
  const response = await fetchImpl(`${GITHUB_LOGIN}/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }).toString()
  });
  const data = await jsonResponse(response, "GitHub authorization could not be refreshed.");
  if (data.error) throw new HttpError(401, "GITHUB_RECONNECT_REQUIRED", "Reconnect GitHub to continue.");
  if (!data.access_token || !data.refresh_token) {
    throw new HttpError(401, "GITHUB_RECONNECT_REQUIRED", "Reconnect GitHub to continue.");
  }
  return data;
}

export function tokenExpiration(seconds, now = new Date()) {
  const duration = Math.max(1, Number(seconds) || 28_800) * 1000;
  return new Date(now.getTime() + duration);
}

export async function getGitHubIdentity(accessToken, fetchImpl = fetch) {
  return githubApi("/user", accessToken, fetchImpl);
}

export async function listInstalledRepositories(accessToken, fetchImpl = fetch) {
  const installations = await githubApi("/user/installations?per_page=100", accessToken, fetchImpl);
  assertSafeGitHubAppPermissions(installations.installations);
  const repositories = [];
  for (const installation of installations.installations || []) {
    let page = 1;
    while (page <= 10) {
      const result = await githubApi(`/user/installations/${installation.id}/repositories?per_page=100&page=${page}`, accessToken, fetchImpl);
      repositories.push(...(result.repositories || []));
      if ((result.repositories || []).length < 100) break;
      page += 1;
    }
  }
  const unique = new Map(repositories.map((repository) => [repository.id, repository]));
  return [...unique.values()].sort((left, right) => left.full_name.localeCompare(right.full_name));
}

export async function revokeGitHubAppAuthorization({ accessToken, clientId, clientSecret, fetchImpl = fetch }) {
  const response = await fetchImpl(`${GITHUB_API}/applications/${encodeURIComponent(clientId)}/grant`, {
    method: "DELETE",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ access_token: accessToken })
  });
  if (response.status === 404) return false;
  await jsonResponse(response, `GitHub authorization could not be revoked (${response.status}).`);
  return true;
}
