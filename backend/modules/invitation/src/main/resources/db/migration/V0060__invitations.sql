CREATE TABLE invitations (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email_original VARCHAR(320) NOT NULL,
    email_normalized VARCHAR(320) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    delivery_token_encrypted TEXT,
    workspace_role VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    smtp_settings_version BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    sent_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES users(id),
    revoked_at TIMESTAMPTZ,
    last_delivery_error VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_invitations_token_hash UNIQUE (token_hash),
    CONSTRAINT ck_invitations_role CHECK (
        workspace_role IN ('ADMIN', 'MEMBER', 'EXTERNAL')
    ),
    CONSTRAINT ck_invitations_status CHECK (
        status IN ('QUEUED', 'SENT', 'FAILED', 'ACCEPTED', 'EXPIRED', 'REVOKED')
    )
);

CREATE UNIQUE INDEX uq_invitations_active_email
    ON invitations (workspace_id, email_normalized)
    WHERE status IN ('QUEUED', 'SENT', 'FAILED');

CREATE INDEX ix_invitations_workspace
    ON invitations (workspace_id, created_at DESC);

CREATE INDEX ix_invitations_expiry
    ON invitations (expires_at)
    WHERE status IN ('QUEUED', 'SENT', 'FAILED');
