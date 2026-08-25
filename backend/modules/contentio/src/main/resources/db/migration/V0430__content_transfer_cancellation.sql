CREATE TABLE content_transfer_cancellation_requests (
    task_id UUID PRIMARY KEY REFERENCES content_transfer_tasks(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ix_content_transfer_cancellations_requested_at
    ON content_transfer_cancellation_requests (requested_at);
