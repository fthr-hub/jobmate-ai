-- Gmail OAuth connections are scoped to the verified Telegram owner.
-- OAuth access and refresh tokens are stored only as AES-GCM ciphertext.
CREATE TABLE IF NOT EXISTS gmail_connections (
  telegram_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  encrypted_tokens TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Short-lived, one-time PKCE state; rows expire after ten minutes.
CREATE TABLE IF NOT EXISTS gmail_oauth_states (
  state TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gmail_oauth_states_expiry
  ON gmail_oauth_states(expires_at);
