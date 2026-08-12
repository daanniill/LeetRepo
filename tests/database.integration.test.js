import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPool, DataStore } from "../server/database.js";

const databaseUrl = process.env.TEST_DATABASE_URL || "";

test("PostgreSQL migrations are idempotent and credential refreshes serialize", { skip: !databaseUrl }, async () => {
  const pool = createPool({
    databaseUrl,
    databaseSsl: false,
    databasePoolMax: 4,
    databaseConnectionTimeoutMs: 5_000,
    databaseIdleTimeoutMs: 5_000,
    databaseStatementTimeoutMs: 10_000
  });
  const store = new DataStore(pool);
  const schema = await readFile(fileURLToPath(new URL("../server/schema.sql", import.meta.url)), "utf8");
  const githubUserId = "900000000001";
  try {
    await pool.query(schema);
    await pool.query(schema);
    await pool.query(
      `INSERT INTO users (github_user_id, github_login)
       VALUES ($1, 'credential-lock-test')
       ON CONFLICT (github_user_id) DO NOTHING`,
      [githubUserId]
    );
    await pool.query(
      `INSERT INTO github_credentials (
         github_user_id, access_token_cipher, refresh_token_cipher,
         access_expires_at, refresh_expires_at
       ) VALUES ($1, 'old-access', 'old-refresh', NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 day')
       ON CONFLICT (github_user_id) DO UPDATE SET
         access_token_cipher = EXCLUDED.access_token_cipher,
         refresh_token_cipher = EXCLUDED.refresh_token_cipher,
         access_expires_at = EXCLUDED.access_expires_at,
         refresh_expires_at = EXCLUDED.refresh_expires_at`,
      [githubUserId]
    );

    let refreshes = 0;
    const refresh = () => store.withLockedCredentials(githubUserId, async (current) => {
      if (current.access_token_cipher === "new-access") return { value: "new-access" };
      refreshes += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        value: "new-access",
        credentials: {
          accessTokenCipher: "new-access",
          refreshTokenCipher: "new-refresh",
          accessExpiresAt: new Date(Date.now() + 3_600_000),
          refreshExpiresAt: new Date(Date.now() + 86_400_000)
        }
      };
    });
    const values = await Promise.all([refresh(), refresh()]);
    assert.deepEqual(values, ["new-access", "new-access"]);
    assert.equal(refreshes, 1);
  } finally {
    await pool.query("DELETE FROM users WHERE github_user_id = $1", [githubUserId]).catch(() => {});
    await store.close();
  }
});
