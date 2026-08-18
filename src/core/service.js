import { LEETREPO_API_BASE_URL } from "../config.js";

function apiBaseUrl() {
  const value = String(LEETREPO_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (!/^https:\/\//.test(value)) throw new Error("LeetRepo's hosted API URL is not configured.");
  return value;
}

export async function hostedRequest(path, {
  method = "GET",
  sessionToken = "",
  body,
  fetchImpl = globalThis.fetch
} = {}) {
  const headers = { Accept: "application/json" };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetchImpl(`${apiBaseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new Error("LeetRepo's service could not be reached. Try again shortly.");
  }
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `LeetRepo's service returned ${response.status}.`);
    error.code = data?.error?.code || "SERVICE_ERROR";
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function beginHostedGitHubSignIn({ redirectUri, launchWebAuthFlow, sessionToken = "", fetchImpl = globalThis.fetch }) {
  const start = await hostedRequest(`/v1/auth/github/start?redirect_uri=${encodeURIComponent(redirectUri)}`, { fetchImpl });
  const finalUrl = await launchWebAuthFlow(start.authorizationUrl);
  const result = new URL(finalUrl);
  const error = result.searchParams.get("error");
  if (error) throw new Error(error);
  const code = result.searchParams.get("code");
  if (!code) throw new Error("GitHub sign-in did not return an authorization code.");
  return hostedRequest("/v1/auth/session/exchange", {
    method: "POST",
    sessionToken,
    body: { code },
    fetchImpl
  });
}

export function launchIdentityWebAuthFlow(chromeApi, url, {
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval
} = {}) {
  return new Promise((resolve, reject) => {
    const keepAlive = setIntervalImpl(() => {
      chromeApi.runtime.getPlatformInfo(() => {
        void chromeApi.runtime.lastError;
      });
    }, 25_000);
    const finish = (callback, value) => {
      clearIntervalImpl(keepAlive);
      callback(value);
    };

    try {
      chromeApi.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
        const runtimeError = chromeApi.runtime.lastError;
        if (runtimeError) finish(reject, new Error(runtimeError.message));
        else if (!redirectUrl) finish(reject, new Error("GitHub sign-in was cancelled."));
        else finish(resolve, redirectUrl);
      });
    } catch (error) {
      finish(reject, error);
    }
  });
}

export function newRequestId(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === "function") return cryptoImpl.randomUUID();
  const bytes = new Uint8Array(18);
  cryptoImpl.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
