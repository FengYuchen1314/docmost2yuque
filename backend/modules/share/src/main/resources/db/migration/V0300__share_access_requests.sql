CREATE TABLE share_access_requests (
    id UUID PRIMARY KEY,
    share_id UUID NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    policy_version BIGINT NOT NULL,
    message VARCHAR(500),
    status VARCHAR(24) NOT NULL,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_share_access_requests_requester UNIQUE (share_id, requester_id),
    CONSTRAINT ck_share_access_requests_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE INDEX ix_share_access_requests_review
    ON share_access_requests (share_id, status, updated_at DESC);

ALTER TABLE share_visits DROP CONSTRAINT ck_share_visits_result;
ALTER TABLE share_visits ADD CONSTRAINT ck_share_visits_result CHECK (
    result IN ('GRANTED', 'PASSWORD_REQUIRED', 'PASSWORD_FAILED', 'APPROVAL_REQUIRED', 'EXPIRED', 'REVOKED')
);
