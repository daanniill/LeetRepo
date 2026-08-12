import { Buffer } from "node:buffer";

function required(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function integer(env, name, fallback, minimum = 1) {
  const parsed = Number.parseInt(env[name] || fallback, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`${name} must be an integer of at least ${minimum}.`);
  return parsed;
}

function origin(value, name) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${name} must use http or https.`);
  return url.origin;
}

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function encryptionKey(value) {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

export function loadConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "development").trim();
  const publicBaseUrl = origin(required(env, "PUBLIC_BASE_URL"), "PUBLIC_BASE_URL");
  const extensionRedirectUris = csv(required(env, "EXTENSION_REDIRECT_URIS"));
  for (const redirectUri of extensionRedirectUris) {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:") throw new Error("Every EXTENSION_REDIRECT_URIS entry must use https.");
  }
  if (nodeEnv === "production" && !publicBaseUrl.startsWith("https://")) {
    throw new Error("PUBLIC_BASE_URL must use https in production.");
  }
  return {
    nodeEnv,
    port: integer(env, "PORT", 8787),
    publicBaseUrl,
    databaseUrl: required(env, "DATABASE_URL"),
    databaseSsl: String(env.DATABASE_SSL || "true") !== "false",
    databasePoolMax: integer(env, "DATABASE_POOL_MAX", 10),
    databaseConnectionTimeoutMs: integer(env, "DATABASE_CONNECTION_TIMEOUT_MS", 5_000, 100),
    databaseIdleTimeoutMs: integer(env, "DATABASE_IDLE_TIMEOUT_MS", 30_000, 1_000),
    databaseStatementTimeoutMs: integer(env, "DATABASE_STATEMENT_TIMEOUT_MS", 10_000, 100),
    githubAppSlug: required(env, "GITHUB_APP_SLUG"),
    githubClientId: required(env, "GITHUB_APP_CLIENT_ID"),
    githubClientSecret: required(env, "GITHUB_APP_CLIENT_SECRET"),
    extensionRedirectUris: new Set(extensionRedirectUris),
    allowedExtensionOrigins: new Set(csv(env.ALLOWED_EXTENSION_ORIGINS)),
    tokenEncryptionKey: encryptionKey(required(env, "TOKEN_ENCRYPTION_KEY")),
    groqApiKey: required(env, "GROQ_API_KEY"),
    groqModel: String(env.GROQ_MODEL || "openai/gpt-oss-120b").trim(),
    freeAiDailyLimit: integer(env, "FREE_AI_DAILY_LIMIT", 3),
    freeAiMonthlyLimit: integer(env, "FREE_AI_MONTHLY_LIMIT", 30),
    globalAiRequestsPerMinute: integer(env, "GLOBAL_AI_REQUESTS_PER_MINUTE", 25),
    sessionTtlDays: integer(env, "SESSION_TTL_DAYS", 30),
    maxRequestBytes: integer(env, "MAX_REQUEST_BYTES", 64 * 1024, 1024)
  };
}
