CREATE TABLE password_login_attempts (
    id UUID PRIMARY KEY,
    principal_hash VARCHAR(128) NOT NULL,
    ip_hash VARCHAR(128) NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ix_password_login_attempts_principal
    ON password_login_attempts (principal_hash, attempted_at DESC);

CREATE INDEX ix_password_login_attempts_ip
    ON password_login_attempts (ip_hash, attempted_at DESC);

CREATE INDEX ix_password_login_attempts_expiry
    ON password_login_attempts (attempted_at);
