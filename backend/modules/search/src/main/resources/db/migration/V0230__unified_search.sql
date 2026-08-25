CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE search_documents (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    resource_type VARCHAR(32) NOT NULL,
    resource_id UUID NOT NULL,
    source_scope VARCHAR(16) NOT NULL,
    title VARCHAR(500) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    labels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    path VARCHAR(500),
    owner_id UUID,
    content_type VARCHAR(32),
    visibility VARCHAR(32) NOT NULL,
    publication_id UUID,
    permission_version BIGINT NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    source_created_at TIMESTAMPTZ NOT NULL,
    source_updated_at TIMESTAMPTZ NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A')
        || setweight(to_tsvector('simple', coalesce(body, '')), 'C')
    ) STORED,
    CONSTRAINT ck_search_documents_resource_type CHECK (
        resource_type IN ('PAGE', 'KNOWLEDGE_BASE', 'QUICK_NOTE', 'TEMPLATE', 'USER', 'TEAM', 'ATTACHMENT')
    ),
    CONSTRAINT ck_search_documents_scope CHECK (
        source_scope IN ('DRAFT', 'PUBLISHED', 'CANONICAL')
    ),
    CONSTRAINT ck_search_documents_visibility CHECK (
        visibility IN ('PRIVATE', 'WORKSPACE', 'PUBLIC')
    ),
    CONSTRAINT ck_search_documents_publication CHECK (
        (source_scope = 'PUBLISHED' AND publication_id IS NOT NULL)
        OR (source_scope <> 'PUBLISHED' AND publication_id IS NULL)
    )
);

CREATE INDEX ix_search_documents_workspace_scope_updated
    ON search_documents (workspace_id, source_scope, source_updated_at DESC)
    WHERE active;

CREATE INDEX ix_search_documents_vector
    ON search_documents USING GIN (search_vector) WHERE active;

CREATE INDEX ix_search_documents_title_trgm
    ON search_documents USING GIN (lower(title) gin_trgm_ops) WHERE active;

CREATE INDEX ix_search_documents_body_trgm
    ON search_documents USING GIN (lower(body) gin_trgm_ops) WHERE active;

CREATE INDEX ix_search_documents_public
    ON search_documents (resource_type, source_updated_at DESC)
    WHERE active AND source_scope = 'PUBLISHED' AND visibility = 'PUBLIC';

CREATE TABLE search_rebuilds (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL,
    cursor_type VARCHAR(32),
    cursor_id UUID,
    processed_count BIGINT NOT NULL DEFAULT 0,
    error_count BIGINT NOT NULL DEFAULT 0,
    requested_by UUID NOT NULL REFERENCES users(id),
    started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    last_error TEXT,
    CONSTRAINT ck_search_rebuilds_status CHECK (
        status IN ('PENDING', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED')
    )
);

CREATE UNIQUE INDEX uq_search_rebuilds_workspace_active
    ON search_rebuilds (workspace_id)
    WHERE status IN ('PENDING', 'RUNNING', 'PAUSED');
