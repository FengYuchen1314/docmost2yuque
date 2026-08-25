CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    workspace_type VARCHAR(32) NOT NULL,
    name VARCHAR(120) NOT NULL,
    default_visibility VARCHAR(32) NOT NULL DEFAULT 'PRIVATE',
    default_publish_mode VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
    security_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_workspaces_type CHECK (workspace_type IN ('PERSONAL', 'ORGANIZATION'))
);

CREATE TABLE workspace_memberships (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT ck_workspace_membership_role CHECK (
        role IN ('OWNER', 'ADMIN', 'MEMBER', 'EXTERNAL')
    )
);

CREATE INDEX ix_workspace_memberships_user
    ON workspace_memberships (user_id, workspace_id);

