import { Buffer } from "node:buffer";
import { decryptSecret, encryptSecret, hashToken, randomToken } from "./crypto.js";
import { HttpError } from "./errors.js";
import {
  exchangeAuthorizationCode,
  getGitHubIdentity,
  listInstalledRepositories,
  refreshUserAccessToken,
  tokenExpiration
} from "./github.js";
import { generateExplanation, MAX_CODE_CHARACTERS } from "../src/core/llm.js";
import { normalizeSubmission } from "../src/core/submissions.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers }
  });
}

function errorResponse(error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof HttpError ? error.message : "The service could not complete this request.";
  return json({ error: { code, message } }, status);
}

function corsHeaders(request, config) {
  const origin = request.headers.get("origin");
  if (!origin || !config.allowedExtensionOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    Vary: "Origin"
  };
}

async function readJson(request, config) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > config.maxRequestBytes) throw new HttpError(413, "REQUEST_TOO_LARGE", "Request body is too large.");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > config.maxRequestBytes) {
    throw new HttpError(413, "REQUEST_TOO_LARGE", "Request body is too large.");
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function bearerToken(request) {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "AUTH_REQUIRED", "Sign in with GitHub to continue.");
  return match[1];
}

async function authenticatedSession(request, store) {
  const token = bearerToken(request);
  const session = await store.getSession(hashToken(token));
  if (!session) throw new HttpError(401, "SESSION_EXPIRED", "Your session expired. Reconnect GitHub.");
  return { token, session };
}

function redirectWithParams(redirectUri, values) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
  });
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
  });
}

function githubCallbackUrl(config) {
  return new URL("/v1/auth/github/callback", config.publicBaseUrl).toString();
}

async function createOAuthFlow(store, extensionRedirectUri) {
  const state = randomToken();
  await store.createOAuthFlow({
    stateHash: hashToken(state),
    extensionRedirectUri,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  });
  return state;
}

function clientRepository(repository) {
  return {
    id: repository.id,
    name: repository.name,
    full_name: repository.full_name,
    private: repository.private === true,
    default_branch: repository.default_branch || "main",
    owner: { login: repository.owner?.login || repository.full_name?.split("/")[0] || "" }
  };
}

function aiSubmission(input) {
  const item = normalizeSubmission(input);
  if (!item.code) throw new HttpError(400, "CODE_REQUIRED", "Solution code is required.");
  return {
    number: item.number,
    title: item.title,
    difficulty: item.difficulty,
    language: item.language,
    code: item.code.slice(0, MAX_CODE_CHARACTERS),
    problemContext: item.problemContext,
    exampleInput: item.exampleInput,
    exampleOutput: item.exampleOutput,
    status: item.status
  };
}

function requestId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(id)) {
    throw new HttpError(400, "INVALID_REQUEST_ID", "A valid AI request ID is required.");
  }
  return id;
}

function usagePayload(usage, config, plan = "free") {
  return {
    plan,
    daily: { ...usage.daily, limit: config.freeAiDailyLimit },
    monthly: { ...usage.monthly, limit: config.freeAiMonthlyLimit }
  };
}

export function createApi({ config, store, fetchImpl = fetch }) {
  return async function handle(request) {
    const cors = corsHeaders(request, config);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/healthz") {
        await store.ping();
        return json({ ok: true }, 200, cors);
      }

      if (request.method === "GET" && url.pathname === "/v1/auth/github/start") {
        const redirectUri = url.searchParams.get("redirect_uri") || "";
        if (!config.extensionRedirectUris.has(redirectUri)) {
          throw new HttpError(400, "INVALID_REDIRECT", "This extension redirect URL is not allowed.");
        }
        const state = await createOAuthFlow(store, redirectUri);
        const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
        authorizationUrl.searchParams.set("client_id", config.githubClientId);
        authorizationUrl.searchParams.set("redirect_uri", githubCallbackUrl(config));
        authorizationUrl.searchParams.set("state", state);
        return json({ authorizationUrl: authorizationUrl.toString() }, 200, cors);
      }

      if (request.method === "GET" && url.pathname === "/v1/auth/github/callback") {
        const state = url.searchParams.get("state") || "";
        const flow = state ? await store.consumeOAuthFlow(hashToken(state)) : null;
        if (!flow) throw new HttpError(400, "INVALID_OAUTH_STATE", "This GitHub sign-in attempt expired. Start again from LeetRepo.");
        if (url.searchParams.get("error")) {
          return redirectWithParams(flow.extension_redirect_uri, { error: "GitHub sign-in was cancelled." });
        }
        const code = url.searchParams.get("code") || "";
        if (!code) return redirectWithParams(flow.extension_redirect_uri, { error: "GitHub did not return an authorization code." });
        try {
          const token = await exchangeAuthorizationCode({
            code,
            clientId: config.githubClientId,
            clientSecret: config.githubClientSecret,
            redirectUri: githubCallbackUrl(config),
            fetchImpl
          });
          if (!token.refresh_token) {
            throw new HttpError(502, "GITHUB_REFRESH_TOKEN_MISSING", "GitHub App token expiration must be enabled.");
          }
          const [user, repositories] = await Promise.all([
            getGitHubIdentity(token.access_token, fetchImpl),
            listInstalledRepositories(token.access_token, fetchImpl)
          ]);
          if (!repositories.length) {
            const installState = await createOAuthFlow(store, flow.extension_redirect_uri);
            const installationUrl = new URL(`https://github.com/apps/${config.githubAppSlug}/installations/new`);
            installationUrl.searchParams.set("state", installState);
            return redirect(installationUrl.toString());
          }
          const exchangeCode = randomToken();
          await store.createAuthExchange({
            codeHash: hashToken(exchangeCode),
            githubUserId: String(user.id),
            githubLogin: user.login,
            avatarUrl: user.avatar_url || "",
            accessTokenCipher: encryptSecret(token.access_token, config.tokenEncryptionKey),
            refreshTokenCipher: encryptSecret(token.refresh_token, config.tokenEncryptionKey),
            accessExpiresAt: tokenExpiration(token.expires_in),
            refreshExpiresAt: tokenExpiration(token.refresh_token_expires_in || 15_897_600),
            repositories: repositories.map(clientRepository),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
          });
          return redirectWithParams(flow.extension_redirect_uri, { code: exchangeCode });
        } catch (error) {
          return redirectWithParams(flow.extension_redirect_uri, {
            error: error instanceof HttpError ? error.message : "GitHub sign-in could not be completed."
          });
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/session/exchange") {
        const body = await readJson(request, config);
        const code = String(body.code || "").trim();
        if (!code) throw new HttpError(400, "AUTH_CODE_REQUIRED", "Authorization code is required.");
        const sessionToken = randomToken();
        const auth = await store.exchangeAuthCode({
          codeHash: hashToken(code),
          sessionHash: hashToken(sessionToken),
          sessionExpiresAt: new Date(Date.now() + config.sessionTtlDays * 86_400_000)
        });
        if (!auth) throw new HttpError(401, "AUTH_CODE_EXPIRED", "This sign-in code expired. Start again.");
        const usage = await store.getAiUsage(auth.githubUserId);
        return json({
          sessionToken,
          githubAccessToken: decryptSecret(auth.accessTokenCipher, config.tokenEncryptionKey),
          githubAccessTokenExpiresAt: new Date(auth.accessExpiresAt).toISOString(),
          user: { id: auth.githubUserId, login: auth.githubLogin, avatar_url: auth.avatarUrl },
          repos: auth.repositories,
          ai: usagePayload(usage, config)
        }, 200, { ...cors, "Cache-Control": "no-store" });
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/github/token") {
        const { session } = await authenticatedSession(request, store);
        const expiresAt = new Date(session.access_expires_at);
        if (expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
          return json({
            githubAccessToken: decryptSecret(session.access_token_cipher, config.tokenEncryptionKey),
            githubAccessTokenExpiresAt: expiresAt.toISOString()
          }, 200, { ...cors, "Cache-Control": "no-store" });
        }
        if (new Date(session.refresh_expires_at).getTime() <= Date.now()) {
          throw new HttpError(401, "GITHUB_RECONNECT_REQUIRED", "Reconnect GitHub to continue.");
        }
        const refreshed = await refreshUserAccessToken({
          refreshToken: decryptSecret(session.refresh_token_cipher, config.tokenEncryptionKey),
          clientId: config.githubClientId,
          clientSecret: config.githubClientSecret,
          fetchImpl
        });
        const credentials = {
          accessTokenCipher: encryptSecret(refreshed.access_token, config.tokenEncryptionKey),
          refreshTokenCipher: encryptSecret(refreshed.refresh_token, config.tokenEncryptionKey),
          accessExpiresAt: tokenExpiration(refreshed.expires_in),
          refreshExpiresAt: tokenExpiration(refreshed.refresh_token_expires_in || 15_897_600)
        };
        await store.updateCredentials(session.github_user_id, credentials);
        return json({
          githubAccessToken: refreshed.access_token,
          githubAccessTokenExpiresAt: credentials.accessExpiresAt.toISOString()
        }, 200, { ...cors, "Cache-Control": "no-store" });
      }

      if (request.method === "DELETE" && url.pathname === "/v1/account") {
        const token = bearerToken(request);
        const deleted = await store.deleteAccountForSession(hashToken(token));
        if (!deleted) throw new HttpError(401, "SESSION_EXPIRED", "Your session already expired.");
        return new Response(null, {
          status: 204,
          headers: { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
        });
      }

      if (request.method === "DELETE" && url.pathname === "/v1/auth/session") {
        const token = bearerToken(request);
        await store.deleteSession(hashToken(token));
        return new Response(null, {
          status: 204,
          headers: { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
        });
      }

      if (request.method === "GET" && url.pathname === "/v1/ai/usage") {
        const { session } = await authenticatedSession(request, store);
        const usage = await store.getAiUsage(session.github_user_id);
        return json(usagePayload(usage, config, session.plan), 200, cors);
      }

      if (request.method === "POST" && url.pathname === "/v1/ai/explanations") {
        const { session } = await authenticatedSession(request, store);
        const body = await readJson(request, config);
        const id = requestId(body.requestId);
        const submission = aiSubmission(body.submission);
        await store.reserveAiRequest({
          githubUserId: session.github_user_id,
          requestId: id,
          dailyLimit: config.freeAiDailyLimit,
          monthlyLimit: config.freeAiMonthlyLimit,
          globalMinuteLimit: config.globalAiRequestsPerMinute
        });
        let generated;
        try {
          generated = await generateExplanation({
            apiKey: config.groqApiKey,
            submission,
            model: config.groqModel,
            fetchImpl
          });
        } catch (error) {
          await store.finishAiRequest({
            githubUserId: session.github_user_id,
            requestId: id,
            inputTokens: 0,
            outputTokens: 0,
            status: "failed"
          });
          throw new HttpError(502, "AI_PROVIDER_ERROR", error.message);
        }
        await store.finishAiRequest({
          githubUserId: session.github_user_id,
          requestId: id,
          inputTokens: generated.usage?.prompt_tokens || generated.usage?.input_tokens || 0,
          outputTokens: generated.usage?.completion_tokens || generated.usage?.output_tokens || 0,
          status: "completed"
        });
        const usage = await store.getAiUsage(session.github_user_id);
        return json({
          review: generated.review,
          model: generated.model,
          usage: usagePayload(usage, config, session.plan)
        }, 200, cors);
      }

      throw new HttpError(404, "NOT_FOUND", "Endpoint not found.");
    } catch (error) {
      const response = errorResponse(error);
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    }
  };
}
