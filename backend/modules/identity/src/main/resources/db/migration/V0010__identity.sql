CREATE TABLE users (
    id UUID PRIMARY KEY,
    email_original VARCHAR(320) NOT NULL,
    email_normalized VARCHAR(320) NOT NULL,
    display_name VARCHAR(200),
    password_hash VARCHAR(500) NOT NULL,
    status VARCHAR(32) NOT NULL,
    email_verified_at TIMESTAMPTZ,
    email_verification_source VARCHAR(32),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_users_email_normalized UNIQUE (email_normalized),
    CONSTRAINT ck_users_status CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
    CONSTRAINT ck_users_email_verification_source CHECK (
        email_verification_source IS NULL
        OR email_verification_source IN ('BOOTSTRAP', 'PUBLIC_SIGNUP', 'INVITATION', 'ADMIN')
    )
);

CREATE TABLE email_auth_challenges (
    id UUID PRIMARY KEY,
    email_normalized VARCHAR(320) NOT NULL,
    purpose VARCHAR(64) NOT NULL,
    code_hash VARCHAR(500),
    token_hash VARCHAR(500),
    delivery_secret_encrypted TEXT,
    pending_password_hash VARCHAR(500),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    requested_ip_hash VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_email_auth_challenge_secret CHECK (
        (code_hash IS NOT NULL AND token_hash IS NULL)
        OR (code_hash IS NULL AND token_hash IS NOT NULL)
    )
);

CREATE INDEX ix_email_auth_challenges_lookup
    ON email_auth_challenges (email_normalized, purpose, created_at DESC);

CREATE INDEX ix_email_auth_challenges_expiry
    ON email_auth_challenges (expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE instance_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL,
    granted_by UUID REFERENCES users(id),
    PRIMARY KEY (user_id, role),
    CONSTRAINT ck_instance_roles_role CHECK (role IN ('OWNER', 'ADMIN'))
);
