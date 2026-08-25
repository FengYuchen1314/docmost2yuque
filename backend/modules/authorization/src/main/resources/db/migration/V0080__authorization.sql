CREATE TABLE permission_versions (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE acl_entries (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    resource_type VARCHAR(64) NOT NULL,
    resource_id UUID NOT NULL,
    subject_type VARCHAR(32) NOT NULL,
    subject_id UUID,
    role VARCHAR(32),
    effect VARCHAR(16) NOT NULL,
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_acl_resource_type CHECK (
        resource_type IN ('WORKSPACE', 'TEAM', 'KNOWLEDGE_BASE', 'PAGE', 'QUICK_NOTE', 'TEMPLATE')
    ),
    CONSTRAINT ck_acl_subject_type CHECK (
        subject_type IN ('USER', 'TEAM', 'PUBLIC', 'INVITE', 'API_CLIENT')
    ),
    CONSTRAINT ck_acl_effect CHECK (effect IN ('ALLOW', 'DENY')),
    CONSTRAINT ck_acl_subject_id CHECK (
        (subject_type = 'PUBLIC' AND subject_id IS NULL)
        OR (subject_type <> 'PUBLIC' AND subject_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_acl_active_subject
    ON acl_entries (resource_type, resource_id, subject_type, subject_id)
    WHERE deleted_at IS NULL AND subject_id IS NOT NULL;

CREATE UNIQUE INDEX uq_acl_active_public
    ON acl_entries (resource_type, resource_id, subject_type)
    WHERE deleted_at IS NULL AND subject_type = 'PUBLIC';

CREATE INDEX ix_acl_resolution
    ON acl_entries (workspace_id, resource_type, resource_id, subject_type, subject_id)
    WHERE deleted_at IS NULL;
