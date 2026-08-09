import pg from "pg";
import { HttpError, QuotaError } from "./errors.js";

const { Pool } = pg;

function dayKey(now) {
  return now.toISOString().slice(0, 10);
}

function monthKey(now) {
  return `${now.toISOString().slice(0, 7)}-01`;
}

function minuteKey(now) {
  return `${now.toISOString().slice(0, 16)}:00.000Z`;
}

function number(value) {
  return Math.max(0, Number(value) || 0);
}

export function createPool(config) {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30_000
  });
}

export class DataStore {
  constructor(pool) {
    this.pool = pool;
  }

  async ping() {
    await this.pool.query("SELECT 1");
  }

  async close() {
    await this.pool.end();
  }

  async cleanupExpiredData() {
    await this.pool.query("DELETE FROM oauth_flows WHERE expires_at <= NOW()");
    await this.pool.query("DELETE FROM auth_exchanges WHERE expires_at <= NOW()");
    await this.pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
    await this.pool.query("DELETE FROM ai_global_minute_usage WHERE minute_bucket < NOW() - INTERVAL '1 day'");
    await this.pool.query("DELETE FROM ai_requests WHERE created_at < NOW() - INTERVAL '31 days'");
    await this.pool.query(
      `DELETE FROM users u
       WHERE u.updated_at < NOW() - INTERVAL '31 days'
         AND NOT EXISTS (
           SELECT 1 FROM sessions s
           WHERE s.github_user_id = u.github_user_id AND s.expires_at > NOW()
         )`
    );
  }

  async createOAuthFlow({ stateHash, extensionRedirectUri, expiresAt }) {
    await this.pool.query(
      `INSERT INTO oauth_flows (state_hash, extension_redirect_uri, expires_at)
       VALUES ($1, $2, $3)`,
      [stateHash, extensionRedirectUri, expiresAt]
    );
  }

  async consumeOAuthFlow(stateHash) {
    const result = await this.pool.query(
      `DELETE FROM oauth_flows
       WHERE state_hash = $1 AND expires_at > NOW()
       RETURNING extension_redirect_uri`,
      [stateHash]
    );
    return result.rows[0] || null;
  }

  async createAuthExchange(value) {
    await this.pool.query(
      `INSERT INTO auth_exchanges (
         code_hash, github_user_id, github_login, avatar_url,
         access_token_cipher, refresh_token_cipher, access_expires_at,
         refresh_expires_at, repositories, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        value.codeHash,
        value.githubUserId,
        value.githubLogin,
        value.avatarUrl,
        value.accessTokenCipher,
        value.refreshTokenCipher,
        value.accessExpiresAt,
        value.refreshExpiresAt,
        JSON.stringify(value.repositories),
        value.expiresAt
      ]
    );
  }

  async exchangeAuthCode({ codeHash, sessionHash, sessionExpiresAt }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const exchange = await client.query(
        `DELETE FROM auth_exchanges
         WHERE code_hash = $1 AND expires_at > NOW()
         RETURNING *`,
        [codeHash]
      );
      const auth = exchange.rows[0];
      if (!auth) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `INSERT INTO users (github_user_id, github_login, avatar_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (github_user_id) DO UPDATE SET
           github_login = EXCLUDED.github_login,
           avatar_url = EXCLUDED.avatar_url,
           updated_at = NOW()`,
        [auth.github_user_id, auth.github_login, auth.avatar_url]
      );
      await client.query(
        `INSERT INTO github_credentials (
           github_user_id, access_token_cipher, refresh_token_cipher,
           access_expires_at, refresh_expires_at
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (github_user_id) DO UPDATE SET
           access_token_cipher = EXCLUDED.access_token_cipher,
           refresh_token_cipher = EXCLUDED.refresh_token_cipher,
           access_expires_at = EXCLUDED.access_expires_at,
           refresh_expires_at = EXCLUDED.refresh_expires_at,
           updated_at = NOW()`,
        [
          auth.github_user_id,
          auth.access_token_cipher,
          auth.refresh_token_cipher,
          auth.access_expires_at,
          auth.refresh_expires_at
        ]
      );
      await client.query(
        `INSERT INTO sessions (token_hash, github_user_id, expires_at)
         VALUES ($1, $2, $3)`,
        [sessionHash, auth.github_user_id, sessionExpiresAt]
      );
      await client.query("COMMIT");
      return {
        githubUserId: String(auth.github_user_id),
        githubLogin: auth.github_login,
        avatarUrl: auth.avatar_url,
        accessTokenCipher: auth.access_token_cipher,
        accessExpiresAt: auth.access_expires_at,
        repositories: auth.repositories || []
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSession(sessionHash) {
    const result = await this.pool.query(
      `SELECT
         u.github_user_id::text, u.github_login, u.avatar_url, u.plan,
         c.access_token_cipher, c.refresh_token_cipher,
         c.access_expires_at, c.refresh_expires_at
       FROM sessions s
       JOIN users u ON u.github_user_id = s.github_user_id
       JOIN github_credentials c ON c.github_user_id = u.github_user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [sessionHash]
    );
    return result.rows[0] || null;
  }

  async updateCredentials(githubUserId, value) {
    await this.pool.query(
      `UPDATE github_credentials SET
         access_token_cipher = $2,
         refresh_token_cipher = $3,
         access_expires_at = $4,
         refresh_expires_at = $5,
         updated_at = NOW()
       WHERE github_user_id = $1`,
      [githubUserId, value.accessTokenCipher, value.refreshTokenCipher, value.accessExpiresAt, value.refreshExpiresAt]
    );
  }

  async deleteSession(sessionHash) {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [sessionHash]);
  }

  async deleteAccountForSession(sessionHash) {
    const result = await this.pool.query(
      `DELETE FROM users
       WHERE github_user_id = (
         SELECT github_user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW()
       )
       RETURNING github_user_id`,
      [sessionHash]
    );
    return result.rowCount > 0;
  }

  async reserveAiRequest({ githubUserId, requestId, dailyLimit, monthlyLimit, globalMinuteLimit, now = new Date() }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO ai_requests (github_user_id, request_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING request_id`,
        [githubUserId, requestId]
      );
      if (!inserted.rowCount) throw new HttpError(409, "DUPLICATE_REQUEST", "This AI request was already submitted.");

      const date = dayKey(now);
      const month = monthKey(now);
      const minute = minuteKey(now);
      await client.query(
        `INSERT INTO ai_daily_usage (github_user_id, usage_date)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [githubUserId, date]
      );
      await client.query(
        `INSERT INTO ai_monthly_usage (github_user_id, usage_month)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [githubUserId, month]
      );
      await client.query(
        `INSERT INTO ai_global_minute_usage (minute_bucket)
         VALUES ($1) ON CONFLICT DO NOTHING`,
        [minute]
      );

      const daily = await client.query(
        "SELECT requests FROM ai_daily_usage WHERE github_user_id = $1 AND usage_date = $2 FOR UPDATE",
        [githubUserId, date]
      );
      const monthly = await client.query(
        "SELECT requests FROM ai_monthly_usage WHERE github_user_id = $1 AND usage_month = $2 FOR UPDATE",
        [githubUserId, month]
      );
      const global = await client.query(
        "SELECT requests FROM ai_global_minute_usage WHERE minute_bucket = $1 FOR UPDATE",
        [minute]
      );
      if (number(daily.rows[0]?.requests) >= dailyLimit) {
        throw new QuotaError("AI_DAILY_LIMIT", `Daily AI limit reached (${dailyLimit}).`);
      }
      if (number(monthly.rows[0]?.requests) >= monthlyLimit) {
        throw new QuotaError("AI_MONTHLY_LIMIT", `Monthly AI limit reached (${monthlyLimit}).`);
      }
      if (number(global.rows[0]?.requests) >= globalMinuteLimit) {
        throw new QuotaError("AI_BUSY", "AI explanations are busy. Try again in a minute.");
      }

      await client.query("UPDATE ai_daily_usage SET requests = requests + 1 WHERE github_user_id = $1 AND usage_date = $2", [githubUserId, date]);
      await client.query("UPDATE ai_monthly_usage SET requests = requests + 1 WHERE github_user_id = $1 AND usage_month = $2", [githubUserId, month]);
      await client.query("UPDATE ai_global_minute_usage SET requests = requests + 1 WHERE minute_bucket = $1", [minute]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async finishAiRequest({ githubUserId, requestId, inputTokens, outputTokens, status, now = new Date() }) {
    const date = dayKey(now);
    const month = monthKey(now);
    const safeInput = number(inputTokens);
    const safeOutput = number(outputTokens);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE ai_requests SET status = $3, input_tokens = $4, output_tokens = $5, completed_at = NOW()
         WHERE github_user_id = $1 AND request_id = $2`,
        [githubUserId, requestId, status, safeInput, safeOutput]
      );
      await client.query(
        `UPDATE ai_daily_usage SET input_tokens = input_tokens + $3, output_tokens = output_tokens + $4
         WHERE github_user_id = $1 AND usage_date = $2`,
        [githubUserId, date, safeInput, safeOutput]
      );
      await client.query(
        `UPDATE ai_monthly_usage SET input_tokens = input_tokens + $3, output_tokens = output_tokens + $4
         WHERE github_user_id = $1 AND usage_month = $2`,
        [githubUserId, month, safeInput, safeOutput]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAiUsage(githubUserId, now = new Date()) {
    const [daily, monthly] = await Promise.all([
      this.pool.query(
        `SELECT requests, input_tokens, output_tokens FROM ai_daily_usage
         WHERE github_user_id = $1 AND usage_date = $2`,
        [githubUserId, dayKey(now)]
      ),
      this.pool.query(
        `SELECT requests, input_tokens, output_tokens FROM ai_monthly_usage
         WHERE github_user_id = $1 AND usage_month = $2`,
        [githubUserId, monthKey(now)]
      )
    ]);
    const normalize = (row = {}) => ({
      requests: number(row.requests),
      inputTokens: number(row.input_tokens),
      outputTokens: number(row.output_tokens)
    });
    return { daily: normalize(daily.rows[0]), monthly: normalize(monthly.rows[0]) };
  }
}
