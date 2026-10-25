-- Sesje administratora i próby logowania (ochrona przed brute-force).

CREATE TABLE admin_sessions (
  -- SHA-256 tokenu z cookie (hex). Sam token nie jest nigdzie zapisywany.
  id            TEXT PRIMARY KEY,
  -- Token CSRF powiązany z sesją; klient odsyła go w nagłówku przy operacjach zmieniających stan.
  csrf_token    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  user_agent    TEXT,
  ip            TEXT,

  CONSTRAINT admin_sessions_id_chk CHECK (id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_sessions_expiry_chk CHECK (expires_at > created_at)
);

CREATE INDEX admin_sessions_expires_idx ON admin_sessions (expires_at);

CREATE TABLE login_attempts (
  id          BIGSERIAL PRIMARY KEY,
  ip          TEXT NOT NULL,
  -- Login/e-mail z formularza, znormalizowany (trim + lower), obcięty do 200 znaków.
  identifier  TEXT NOT NULL,
  succeeded   BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, created_at) WHERE NOT succeeded;
CREATE INDEX login_attempts_identifier_idx ON login_attempts (identifier, created_at) WHERE NOT succeeded;
CREATE INDEX login_attempts_created_idx ON login_attempts (created_at);
