CREATE TABLE IF NOT EXISTS oauth_flows (
  state_hash TEXT PRIMARY KEY,
  extension_redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_exchanges (
  code_hash TEXT PRIMARY KEY,
  github_user_id BIGINT NOT NULL,
  github_login TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  access_token_cipher TEXT NOT NULL,
  refresh_token_cipher TEXT NOT NULL,
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  repositories JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  github_user_id BIGINT PRIMARY KEY,
  github_login TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS github_credentials (
  github_user_id BIGINT PRIMARY KEY REFERENCES users(github_user_id) ON DELETE CASCADE,
  access_token_cipher TEXT NOT NULL,
  refresh_token_cipher TEXT NOT NULL,
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  github_user_id BIGINT NOT NULL REFERENCES users(github_user_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_daily_usage (
  github_user_id BIGINT NOT NULL REFERENCES users(github_user_id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (github_user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS ai_monthly_usage (
  github_user_id BIGINT NOT NULL REFERENCES users(github_user_id) ON DELETE CASCADE,
  usage_month DATE NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (github_user_id, usage_month)
);

CREATE TABLE IF NOT EXISTS ai_global_minute_usage (
  minute_bucket TIMESTAMPTZ PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_requests (
  github_user_id BIGINT NOT NULL REFERENCES users(github_user_id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (github_user_id, request_id)
);

CREATE INDEX IF NOT EXISTS oauth_flows_expires_at_idx ON oauth_flows(expires_at);
CREATE INDEX IF NOT EXISTS auth_exchanges_expires_at_idx ON auth_exchanges(expires_at);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS ai_requests_created_at_idx ON ai_requests(created_at);

