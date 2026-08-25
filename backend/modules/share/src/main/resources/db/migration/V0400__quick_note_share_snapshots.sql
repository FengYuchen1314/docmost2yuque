ALTER TABLE shares DROP CONSTRAINT ck_shares_resource_type;

ALTER TABLE shares
    ADD CONSTRAINT ck_shares_resource_type CHECK (
        resource_type IN ('PAGE', 'KNOWLEDGE_BASE', 'QUICK_NOTE')
    );

ALTER TABLE content_events DROP CONSTRAINT ck_content_events_resource_type;

ALTER TABLE content_events
    ADD CONSTRAINT ck_content_events_resource_type CHECK (
        resource_type IN ('PAGE', 'KNOWLEDGE_BASE', 'QUICK_NOTE')
    );

CREATE TABLE quick_note_share_snapshots (
    share_id UUID PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
    quick_note_id UUID NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
    source_revision BIGINT NOT NULL,
    content_json JSONB NOT NULL,
    plain_text TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_quick_note_share_snapshot_revision CHECK (source_revision > 0)
);

CREATE INDEX ix_quick_note_share_snapshots_note
    ON quick_note_share_snapshots (quick_note_id, captured_at DESC);
