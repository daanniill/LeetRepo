import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../server/api.js";
import { decryptSecret, encryptSecret } from "../server/crypto.js";

function config() {
  return {
    publicBaseUrl: "https://api.leetrepo.app",
    githubAppSlug: "leetrepo",
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    extensionRedirectUris: new Set(["https://extension-id.chromiumapp.org/github"]),
    allowedExtensionOrigins: new Set(["chrome-extension://extension-id"]),
    tokenEncryptionKey: Buffer.alloc(32, 7),
    groqApiKey: "gsk_server_secret",
    groqModel: "llama-3.3-70b-versatile",
    freeAiDailyLimit: 3,
    freeAiMonthlyLimit: 30,
    globalAiRequestsPerMinute: 25,
    sessionTtlDays: 30,
    maxRequestBytes: 64 * 1024
  };
}

function baseStore(overrides = {}) {
  return {
    async ping() {},
    async createOAuthFlow() {},
    async consumeOAuthFlow() { return null; },
    async createAuthExchange() {},
    async exchangeAuthCode() { return null; },
    async getSession() { return null; },
    async updateCredentials() {},
    async deleteSession() {},
    async deleteAccountForSession() { return false; },
    async reserveAiRequest() {},
    async finishAiRequest() {},
    async getAiUsage() { return { daily: { requests: 0, inputTokens: 0, outputTokens: 0 }, monthly: { requests: 0, inputTokens: 0, outputTokens: 0 } }; },
    ...overrides
  };
}

test("OAuth start accepts only configured extension redirects and stores hashed state", async () => {
  let flow;
  const api = createApi({
    config: config(),
    store: baseStore({ async createOAuthFlow(value) { flow = value; } })
  });
  const response = await api(new Request("https://api.leetrepo.app/v1/auth/github/start?redirect_uri=https%3A%2F%2Fextension-id.chromiumapp.org%2Fgithub"));
  const body = await response.json();
  assert.equal(response.status, 200);
  const authorizationUrl = new URL(body.authorizationUrl);
  assert.equal(authorizationUrl.origin, "https://github.com");
  assert.equal(authorizationUrl.pathname, "/login/oauth/authorize");
  assert.equal(authorizationUrl.searchParams.get("client_id"), "client-id");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "https://api.leetrepo.app/v1/auth/github/callback");
  assert.ok(authorizationUrl.searchParams.get("state"));
  assert.equal(flow.extensionRedirectUri, "https://extension-id.chromiumapp.org/github");
  assert.doesNotMatch(body.authorizationUrl, new RegExp(flow.stateHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const rejected = await api(new Request("https://api.leetrepo.app/v1/auth/github/start?redirect_uri=https%3A%2F%2Fevil.example%2Fcallback"));
  assert.equal(rejected.status, 400);
});

test("OAuth callback sends first-time users to GitHub App installation", async () => {
  const createdFlows = [];
  const store = baseStore({
    async consumeOAuthFlow() { return { extension_redirect_uri: "https://extension-id.chromiumapp.org/github" }; },
    async createOAuthFlow(value) { createdFlows.push(value); }
  });
  const fetchImpl = async (url) => {
    if (url.endsWith("/login/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "ghu_access", refresh_token: "ghr_refresh", expires_in: 28800, refresh_token_expires_in: 15897600 }), { status: 200 });
    }
    if (url.endsWith("/user")) return new Response(JSON.stringify({ id: 42, login: "alex-c" }), { status: 200 });
    if (url.includes("/user/installations?")) return new Response(JSON.stringify({ installations: [] }), { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const api = createApi({ config: config(), store, fetchImpl });
  const response = await api(new Request("https://api.leetrepo.app/v1/auth/github/callback?state=state&code=github-code"));
  const location = new URL(response.headers.get("location"));
  assert.equal(response.status, 302);
  assert.equal(location.pathname, "/apps/leetrepo/installations/new");
  assert.ok(location.searchParams.get("state"));
  assert.equal(createdFlows.length, 1);
  assert.equal(createdFlows[0].extensionRedirectUri, "https://extension-id.chromiumapp.org/github");
});

test("OAuth callback verifies the installation through the user token and creates a one-time exchange", async () => {
  let exchange;
  const store = baseStore({
    async consumeOAuthFlow() { return { extension_redirect_uri: "https://extension-id.chromiumapp.org/github" }; },
    async createAuthExchange(value) { exchange = value; }
  });
  const fetchImpl = async (url) => {
    if (url.endsWith("/login/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "ghu_access", refresh_token: "ghr_refresh", expires_in: 28800, refresh_token_expires_in: 15897600 }), { status: 200 });
    }
    if (url.endsWith("/user")) return new Response(JSON.stringify({ id: 42, login: "alex-c", avatar_url: "https://example.com/avatar" }), { status: 200 });
    if (url.includes("/user/installations?")) return new Response(JSON.stringify({ installations: [{ id: 9 }] }), { status: 200 });
    if (url.includes("/user/installations/9/repositories")) {
      return new Response(JSON.stringify({ repositories: [{ id: 7, name: "solutions", full_name: "alex-c/solutions", default_branch: "main", owner: { login: "alex-c" } }] }), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const api = createApi({ config: config(), store, fetchImpl });
  const response = await api(new Request("https://api.leetrepo.app/v1/auth/github/callback?state=state&code=github-code"));
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /^https:\/\/extension-id\.chromiumapp\.org\/github\?code=/);
  assert.equal(exchange.githubUserId, "42");
  assert.equal(exchange.repositories[0].full_name, "alex-c/solutions");
  assert.equal(decryptSecret(exchange.accessTokenCipher, config().tokenEncryptionKey), "ghu_access");
});

test("AI endpoint authenticates, reserves server quota, and keeps the provider key server-side", async () => {
  const key = config().tokenEncryptionKey;
  const calls = [];
  let reserved;
  const store = baseStore({
    async getSession() {
      return {
        github_user_id: "42",
        plan: "free",
        access_token_cipher: encryptSecret("ghu_access", key),
        refresh_token_cipher: encryptSecret("ghr_refresh", key),
        access_expires_at: new Date(Date.now() + 3_600_000),
        refresh_expires_at: new Date(Date.now() + 86_400_000)
      };
    },
    async reserveAiRequest(value) { reserved = value; },
    async getAiUsage() {
      return { daily: { requests: 1, inputTokens: 120, outputTokens: 90 }, monthly: { requests: 1, inputTokens: 120, outputTokens: 90 } };
    }
  });
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      model: "llama-3.3-70b-versatile",
      choices: [{ message: { content: JSON.stringify({
        summary: "Track values already seen and look up each complement.",
        patterns: ["Hashing"],
        approach: ["Create a map.", "Scan once and check complements."],
        complexity: { time: "O(n)", space: "O(n)" },
        edgeCases: ["Duplicate values", "First element is used"]
      }) } }],
      usage: { prompt_tokens: 120, completion_tokens: 90 }
    }), { status: 200 });
  };
  const api = createApi({ config: config(), store, fetchImpl });
  const response = await api(new Request("https://api.leetrepo.app/v1/ai/explanations", {
    method: "POST",
    headers: { Authorization: "Bearer session", "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: "request_1234567890",
      model: "attacker-controlled-model",
      submission: { number: 1, title: "Two Sum", difficulty: "Easy", language: "Python3", code: "return [0, 1]" }
    })
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls[0].init.headers.Authorization, "Bearer gsk_server_secret");
  assert.equal(calls[0].body.model, "llama-3.3-70b-versatile");
  assert.equal(reserved.dailyLimit, 3);
  assert.equal(body.usage.daily.requests, 1);
});

test("AES-GCM credential storage rejects tampering", () => {
  const key = Buffer.alloc(32, 4);
  const encrypted = encryptSecret("secret", key);
  assert.equal(decryptSecret(encrypted, key), "secret");
  assert.throws(() => decryptSecret(`${encrypted.slice(0, -1)}A`, key));
});

test("sign out revokes only the current hosted session", async () => {
  let deletedSessionHash = "";
  let accountDeleted = false;
  const store = baseStore({
    async deleteSession(value) { deletedSessionHash = value; },
    async deleteAccountForSession() { accountDeleted = true; return true; }
  });
  const api = createApi({ config: config(), store });
  const response = await api(new Request("https://api.leetrepo.app/v1/auth/session", {
    method: "DELETE",
    headers: { Authorization: "Bearer session-token" }
  }));
  assert.equal(response.status, 204);
  assert.ok(deletedSessionHash);
  assert.equal(accountDeleted, false);
});
