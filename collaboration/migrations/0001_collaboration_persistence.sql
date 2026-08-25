CREATE TABLE IF NOT EXISTS collaboration_documents (
    page_id UUID PRIMARY KEY,
    sequence BIGINT NOT NULL DEFAULT 0,
    snapshot BYTEA NOT NULL DEFAULT '\\x'::bytea,
    snapshot_sequence BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_collaboration_sequence CHECK (sequence >= snapshot_sequence)
);

CREATE TABLE IF NOT EXISTS collaboration_updates (
    page_id UUID NOT NULL REFERENCES collaboration_documents(page_id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL,
    payload BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, sequence)
);

CREATE INDEX IF NOT EXISTS ix_collaboration_updates_created
    ON collaboration_updates (created_at);
