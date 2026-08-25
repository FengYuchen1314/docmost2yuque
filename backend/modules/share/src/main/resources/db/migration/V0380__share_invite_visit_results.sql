ALTER TABLE share_visits
    DROP CONSTRAINT ck_share_visits_result;

ALTER TABLE share_visits
    ADD CONSTRAINT ck_share_visits_result CHECK (
        result IN (
            'GRANTED',
            'PASSWORD_REQUIRED',
            'PASSWORD_FAILED',
            'APPROVAL_REQUIRED',
            'EXPIRED',
            'REVOKED',
            'INVITE_PENDING',
            'INVITE_ACCEPTED'
        )
    );
