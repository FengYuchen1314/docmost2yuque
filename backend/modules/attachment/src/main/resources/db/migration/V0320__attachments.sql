CREATE TABLE attachments (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
    original_name VARCHAR(255) NOT NULL,
    media_type VARCHAR(200) NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    storage_key VARCHAR(500) NOT NULL UNIQUE,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_attachments_size CHECK (size_bytes > 0)
);

CREATE INDEX ix_attachments_page_created
    ON attachments (page_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX ix_attachments_workspace_created
    ON attachments (workspace_id, created_at DESC)
    WHERE deleted_at IS NULL;
