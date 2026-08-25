CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(150) NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ix_outbox_events_pending
    ON outbox_events (occurred_at, id)
    WHERE published_at IS NULL;

CREATE TABLE durable_jobs (
    id UUID PRIMARY KEY,
    job_type VARCHAR(150) NOT NULL,
    idempotency_key VARCHAR(300) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL,
    available_at TIMESTAMPTZ NOT NULL,
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(200),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 10,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    CONSTRAINT uq_durable_jobs_idempotency UNIQUE (idempotency_key),
    CONSTRAINT ck_durable_jobs_status CHECK (
        status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
    )
);

CREATE INDEX ix_durable_jobs_available
    ON durable_jobs (available_at, id)
    WHERE status = 'PENDING';
