CREATE TABLE collaboration_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    http_session_hash CHAR(64) NOT NULL UNIQUE,
    last_issued_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ix_collaboration_sessions_active_user
    ON collaboration_sessions (user_id, last_issued_at DESC)
    WHERE revoked_at IS NULL;
