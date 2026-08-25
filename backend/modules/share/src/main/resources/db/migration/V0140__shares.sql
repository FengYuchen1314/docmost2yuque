CREATE TABLE shares (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    resource_type VARCHAR(32) NOT NULL,
    resource_id UUID NOT NULL,
    share_type VARCHAR(32) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    password_hash VARCHAR(500),
    role VARCHAR(32) NOT NULL,
    require_approval BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ,
    allow_copy BOOLEAN NOT NULL DEFAULT TRUE,
    allow_download BOOLEAN NOT NULL DEFAULT FALSE,
    allow_export BOOLEAN NOT NULL DEFAULT FALSE,
    allow_comment BOOLEAN NOT NULL DEFAULT FALSE,
    allow_search_index BOOLEAN NOT NULL DEFAULT FALSE,
    policy_version BIGINT NOT NULL DEFAULT 1,
    created_by UUID NOT NULL REFERENCES users(id),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_shares_token_hash UNIQUE (token_hash),
    CONSTRAINT ck_shares_resource_type CHECK (resource_type IN ('PAGE', 'KNOWLEDGE_BASE')),
    CONSTRAINT ck_shares_share_type CHECK (share_type IN ('PUBLIC', 'INVITE_LINK')),
    CONSTRAINT ck_shares_role CHECK (role IN ('READER', 'COMMENTER', 'EDITOR'))
);

CREATE INDEX ix_shares_resource_active
    ON shares (resource_type, resource_id, created_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE share_access_sessions (
    id UUID PRIMARY KEY,
    share_id UUID NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_share_access_sessions_token UNIQUE (token_hash)
);

CREATE INDEX ix_share_access_sessions_expiry
    ON share_access_sessions (expires_at);

CREATE TABLE share_visits (
    id UUID PRIMARY KEY,
    share_id UUID NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    visitor_hash VARCHAR(128),
    authenticated_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    result VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_share_visits_result CHECK (
        result IN ('GRANTED', 'PASSWORD_REQUIRED', 'PASSWORD_FAILED', 'EXPIRED', 'REVOKED')
    )
);

CREATE INDEX ix_share_visits_rate_limit
    ON share_visits (share_id, visitor_hash, created_at DESC);
