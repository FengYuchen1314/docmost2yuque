CREATE TABLE templates (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    template_type VARCHAR(32) NOT NULL,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    category VARCHAR(80),
    thumbnail VARCHAR(2000),
    source_resource_id UUID,
    snapshot JSONB NOT NULL,
    visibility VARCHAR(16) NOT NULL,
    use_count BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_templates_type CHECK (template_type IN ('DOCUMENT', 'KNOWLEDGE_BASE')),
    CONSTRAINT ck_templates_visibility CHECK (visibility IN ('PRIVATE', 'WORKSPACE'))
);
CREATE INDEX ix_templates_workspace_gallery ON templates (workspace_id, template_type, category, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE template_instances (
    id UUID PRIMARY KEY,
    template_id UUID NOT NULL REFERENCES templates(id),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    target_resource_type VARCHAR(32) NOT NULL,
    target_resource_id UUID NOT NULL,
    resource_mapping JSONB NOT NULL,
    instantiated_by UUID NOT NULL REFERENCES users(id),
    instantiated_at TIMESTAMPTZ NOT NULL
);
