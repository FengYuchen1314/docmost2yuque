CREATE TABLE account_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash CHAR(64) NOT NULL UNIQUE,
    user_agent VARCHAR(1000) NOT NULL,
    ip_address VARCHAR(64) NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(40)
);

CREATE INDEX ix_account_sessions_active_user
    ON account_sessions (user_id, last_seen_at DESC)
    WHERE revoked_at IS NULL;
