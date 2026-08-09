import test from "node:test";
import assert from "node:assert/strict";
import { beginHostedGitHubSignIn, hostedRequest, newRequestId } from "../src/core/service.js";

test("hosted GitHub sign-in exchanges only the one-time callback code", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes("/v1/auth/github/start")) {
      return new Response(JSON.stringify({ authorizationUrl: "https://github.com/login/oauth/authorize?client_id=client-id&state=state" }), { status: 200 });
    }
    return new Response(JSON.stringify({
      sessionToken: "session-token",
      githubAccessToken: "github-token",
      user: { id: "1", login: "alex-c" },
      repos: []
    }), { status: 200 });
  };
  const result = await beginHostedGitHubSignIn({
    redirectUri: "https://extension-id.chromiumapp.org/github",
    launchWebAuthFlow: async (url) => {
      assert.match(url, /^https:\/\/github\.com\/login\/oauth\/authorize/);
      return "https://extension-id.chromiumapp.org/github?code=one-time-code";
    },
    fetchImpl
  });
  assert.equal(result.sessionToken, "session-token");
  assert.deepEqual(calls[1].body, { code: "one-time-code" });
  assert.equal(calls[1].init.method, "POST");
});

test("hostedRequest surfaces safe API errors", async () => {
  await assert.rejects(
    hostedRequest("/v1/ai/usage", {
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: "SESSION_EXPIRED", message: "Reconnect GitHub." } }), { status: 401 })
    }),
    (error) => error.code === "SESSION_EXPIRED" && error.message === "Reconnect GitHub."
  );
});

test("newRequestId returns an API-safe unique identifier", () => {
  const first = newRequestId();
  const second = newRequestId();
  assert.match(first, /^[A-Za-z0-9_-]{16,100}$/);
  assert.notEqual(first, second);
});
