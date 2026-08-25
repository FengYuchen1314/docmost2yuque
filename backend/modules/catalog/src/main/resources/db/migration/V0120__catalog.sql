CREATE TABLE catalog_nodes (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    node_type VARCHAR(32) NOT NULL,
    page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES catalog_nodes(id) ON DELETE CASCADE,
    position VARCHAR(40) NOT NULL,
    title_override VARCHAR(500),
    url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_catalog_nodes_type CHECK (node_type IN ('DOCUMENT', 'LINK', 'GROUP')),
    CONSTRAINT ck_catalog_nodes_payload CHECK (
        (node_type = 'DOCUMENT' AND page_id IS NOT NULL AND url IS NULL)
        OR (node_type = 'LINK' AND page_id IS NULL AND url IS NOT NULL)
        OR (node_type = 'GROUP' AND page_id IS NULL AND url IS NULL)
    ),
    CONSTRAINT ck_catalog_nodes_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id),
    CONSTRAINT ck_catalog_nodes_position CHECK (position ~ '^[0-9]{39}$')
);

CREATE UNIQUE INDEX uq_catalog_document_active
    ON catalog_nodes (knowledge_base_id, page_id)
    WHERE deleted_at IS NULL AND page_id IS NOT NULL;

CREATE INDEX ix_catalog_nodes_parent_order
    ON catalog_nodes (knowledge_base_id, parent_id, position)
    WHERE deleted_at IS NULL;

CREATE TABLE catalog_revisions (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    revision_no BIGINT NOT NULL,
    operation VARCHAR(64) NOT NULL,
    snapshot JSONB NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_catalog_revisions_number UNIQUE (knowledge_base_id, revision_no)
);

CREATE INDEX ix_catalog_revisions_kb_number
    ON catalog_revisions (knowledge_base_id, revision_no DESC);
