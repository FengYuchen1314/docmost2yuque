CREATE TABLE page_references (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    source_scope VARCHAR(16) NOT NULL,
    source_revision_no BIGINT NOT NULL,
    source_publication_id UUID REFERENCES page_publications(id) ON DELETE CASCADE,
    target_page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_block_id VARCHAR(200),
    reference_kind VARCHAR(32) NOT NULL,
    embed_mode VARCHAR(16) NOT NULL,
    fixed_publication_id UUID REFERENCES page_publications(id) ON DELETE CASCADE,
    source_pointer VARCHAR(500) NOT NULL,
    display_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    ordinal_no INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_page_references_scope CHECK (
        source_scope IN ('DRAFT', 'PUBLISHED')
    ),
    CONSTRAINT ck_page_references_kind CHECK (
        reference_kind IN ('LINK', 'MENTION', 'EMBED', 'BLOCK_REFERENCE', 'RELATION')
    ),
    CONSTRAINT ck_page_references_mode CHECK (
        embed_mode IN ('LINK', 'TITLE', 'CARD', 'LIVE', 'FIXED')
    ),
    CONSTRAINT ck_page_references_source CHECK (
        (source_scope = 'DRAFT' AND source_publication_id IS NULL)
        OR (source_scope = 'PUBLISHED' AND source_publication_id IS NOT NULL)
    ),
    CONSTRAINT ck_page_references_fixed CHECK (
        (embed_mode = 'FIXED' AND fixed_publication_id IS NOT NULL)
        OR (embed_mode <> 'FIXED' AND fixed_publication_id IS NULL)
    ),
    CONSTRAINT ck_page_references_revision CHECK (source_revision_no >= 0),
    CONSTRAINT ck_page_references_ordinal CHECK (ordinal_no >= 0)
);

CREATE UNIQUE INDEX uq_page_references_draft_pointer
    ON page_references (source_page_id, source_pointer)
    WHERE source_scope = 'DRAFT';

CREATE UNIQUE INDEX uq_page_references_publication_pointer
    ON page_references (source_publication_id, source_pointer)
    WHERE source_scope = 'PUBLISHED';

CREATE INDEX ix_page_references_outgoing
    ON page_references (source_page_id, source_scope, ordinal_no);

CREATE INDEX ix_page_references_backlinks
    ON page_references (target_page_id, source_scope, created_at DESC);

CREATE INDEX ix_page_references_workspace_graph
    ON page_references (workspace_id, source_scope, source_page_id, target_page_id);
