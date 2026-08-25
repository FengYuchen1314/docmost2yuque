CREATE TABLE collaboration_materialization_outbox (
    page_id UUID PRIMARY KEY REFERENCES collaboration_documents(page_id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL,
    actor_id UUID NOT NULL,
    content_type VARCHAR(32) NOT NULL,
    plain_text TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ,
    locked_by UUID,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_collaboration_materialization_sequence CHECK (sequence > 0),
    CONSTRAINT ck_collaboration_materialization_attempts CHECK (attempts >= 0),
    CONSTRAINT ck_collaboration_materialization_content_type CHECK (
        content_type IN ('DOCUMENT', 'WHITEBOARD', 'SPREADSHEET', 'DATABASE')
    )
);

CREATE INDEX ix_collaboration_materialization_available
    ON collaboration_materialization_outbox (available_at, updated_at)
    WHERE locked_at IS NULL;
