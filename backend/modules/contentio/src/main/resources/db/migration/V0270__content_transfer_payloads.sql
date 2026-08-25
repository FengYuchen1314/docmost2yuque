CREATE TABLE content_transfer_payloads (
    task_id UUID PRIMARY KEY REFERENCES content_transfer_tasks(id) ON DELETE CASCADE,
    payload BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ix_content_transfer_tasks_pending
    ON content_transfer_tasks (created_at)
    WHERE status = 'PENDING';
