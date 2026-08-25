CREATE TABLE database_form_submissions (
    id UUID PRIMARY KEY,
    publication_id UUID NOT NULL REFERENCES page_publications(id) ON DELETE CASCADE,
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    row_id UUID NOT NULL,
    submitter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    visitor_hash VARCHAR(128) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    values_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_database_form_submission_request
        UNIQUE (publication_id, idempotency_key),
    CONSTRAINT uq_database_form_submission_row
        UNIQUE (page_id, row_id),
    CONSTRAINT ck_database_form_submission_visitor
        CHECK (length(visitor_hash) BETWEEN 16 AND 128),
    CONSTRAINT ck_database_form_submission_key
        CHECK (length(idempotency_key) BETWEEN 8 AND 200),
    CONSTRAINT ck_database_form_submission_values
        CHECK (jsonb_typeof(values_json) = 'object')
);

CREATE INDEX ix_database_form_submission_publication_time
    ON database_form_submissions (publication_id, created_at DESC);

CREATE INDEX ix_database_form_submission_visitor_time
    ON database_form_submissions (page_id, visitor_hash, created_at DESC);
