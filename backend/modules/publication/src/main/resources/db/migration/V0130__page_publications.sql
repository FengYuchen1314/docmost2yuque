CREATE TABLE page_publications (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    source_history_id UUID REFERENCES page_histories(id) ON DELETE SET NULL,
    source_draft_revision BIGINT NOT NULL,
    content_type VARCHAR(32) NOT NULL,
    title_snapshot VARCHAR(500) NOT NULL,
    content_snapshot JSONB,
    binary_snapshot BYTEA,
    plain_text_snapshot TEXT NOT NULL,
    metadata_snapshot JSONB NOT NULL,
    schema_version INTEGER NOT NULL,
    published_by UUID NOT NULL REFERENCES users(id),
    published_at TIMESTAMPTZ NOT NULL,
    superseded_at TIMESTAMPTZ,
    CONSTRAINT ck_page_publications_snapshot CHECK (
        content_snapshot IS NOT NULL OR binary_snapshot IS NOT NULL
    )
);

CREATE UNIQUE INDEX uq_page_publications_current
    ON page_publications (page_id) WHERE superseded_at IS NULL;

CREATE INDEX ix_page_publications_history
    ON page_publications (page_id, published_at DESC);

CREATE TABLE publication_requests (
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(200) NOT NULL,
    publication_id UUID NOT NULL REFERENCES page_publications(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (page_id, actor_id, idempotency_key)
);

ALTER TABLE pages
    ADD CONSTRAINT fk_pages_published_revision
    FOREIGN KEY (published_revision_id) REFERENCES page_publications(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION protect_publication_snapshot()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.knowledge_base_id IS DISTINCT FROM OLD.knowledge_base_id
       OR NEW.page_id IS DISTINCT FROM OLD.page_id
       OR NEW.source_history_id IS DISTINCT FROM OLD.source_history_id
       OR NEW.source_draft_revision IS DISTINCT FROM OLD.source_draft_revision
       OR NEW.content_type IS DISTINCT FROM OLD.content_type
       OR NEW.title_snapshot IS DISTINCT FROM OLD.title_snapshot
       OR NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
       OR NEW.binary_snapshot IS DISTINCT FROM OLD.binary_snapshot
       OR NEW.plain_text_snapshot IS DISTINCT FROM OLD.plain_text_snapshot
       OR NEW.metadata_snapshot IS DISTINCT FROM OLD.metadata_snapshot
       OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
       OR NEW.published_by IS DISTINCT FROM OLD.published_by
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
        RAISE EXCEPTION 'publication snapshots are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER page_publications_snapshot_immutable
    BEFORE UPDATE ON page_publications
    FOR EACH ROW EXECUTE FUNCTION protect_publication_snapshot();
