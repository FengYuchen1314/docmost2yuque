CREATE TABLE pages (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    icon TEXT,
    cover TEXT,
    content_type VARCHAR(32) NOT NULL,
    path VARCHAR(180) NOT NULL,
    publish_mode VARCHAR(32) NOT NULL DEFAULT 'INHERIT',
    published_revision_id UUID,
    published_at TIMESTAMPTZ,
    visibility_override VARCHAR(32) NOT NULL DEFAULT 'INHERIT',
    document_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    schema_version INTEGER NOT NULL DEFAULT 1,
    draft_revision BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_pages_content_type CHECK (
        content_type IN ('DOCUMENT', 'WHITEBOARD', 'SPREADSHEET', 'DATABASE')
    ),
    CONSTRAINT ck_pages_publish_mode CHECK (
        publish_mode IN ('INHERIT', 'MANUAL', 'AUTO')
    ),
    CONSTRAINT ck_pages_visibility_override CHECK (
        visibility_override IN ('INHERIT', 'PRIVATE', 'WORKSPACE', 'PUBLIC')
    ),
    CONSTRAINT ck_pages_schema_version CHECK (schema_version > 0),
    CONSTRAINT ck_pages_draft_revision CHECK (draft_revision >= 0)
);

CREATE UNIQUE INDEX uq_pages_kb_path_active
    ON pages (knowledge_base_id, lower(path)) WHERE deleted_at IS NULL;

CREATE INDEX ix_pages_kb_updated_active
    ON pages (knowledge_base_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX ix_pages_workspace_deleted
    ON pages (workspace_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;

CREATE TABLE page_drafts (
    page_id UUID PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    content_json JSONB,
    binary_content BYTEA,
    plain_text TEXT NOT NULL DEFAULT '',
    revision_no BIGINT NOT NULL,
    schema_version INTEGER NOT NULL,
    updated_by UUID NOT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_page_drafts_content CHECK (
        content_json IS NOT NULL OR binary_content IS NOT NULL
    )
);

CREATE TABLE page_histories (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    revision_no BIGINT NOT NULL,
    revision_kind VARCHAR(32) NOT NULL,
    description VARCHAR(500),
    title_snapshot VARCHAR(500) NOT NULL,
    content_json_snapshot JSONB,
    binary_snapshot BYTEA,
    plain_text_snapshot TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_page_histories_revision UNIQUE (page_id, revision_no),
    CONSTRAINT ck_page_histories_kind CHECK (
        revision_kind IN ('AUTO', 'MANUAL', 'MIGRATION')
    )
);

CREATE INDEX ix_page_histories_page_revision
    ON page_histories (page_id, revision_no DESC);

ALTER TABLE knowledge_bases
    ADD CONSTRAINT fk_knowledge_bases_homepage
    FOREIGN KEY (homepage_page_id) REFERENCES pages(id) ON DELETE SET NULL;
