CREATE TABLE knowledge_base_merges (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id),
    target_knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id),
    idempotency_key VARCHAR(200) NOT NULL,
    plan_fingerprint VARCHAR(64) NOT NULL,
    result_json JSONB NOT NULL,
    requested_by UUID NOT NULL REFERENCES users(id),
    completed_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_knowledge_base_merge_distinct CHECK (
        source_knowledge_base_id <> target_knowledge_base_id
    ),
    CONSTRAINT uq_knowledge_base_merge_idempotency UNIQUE (
        workspace_id, idempotency_key
    )
);

CREATE UNIQUE INDEX uq_knowledge_base_merge_source
    ON knowledge_base_merges (source_knowledge_base_id);

CREATE INDEX ix_knowledge_base_merge_target_time
    ON knowledge_base_merges (target_knowledge_base_id, completed_at DESC);
