CREATE TABLE page_collaboration_materializations (
    page_id UUID PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL,
    materialized_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_page_collaboration_sequence CHECK (sequence > 0)
);
