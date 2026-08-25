CREATE TABLE smtp_settings (
    id SMALLINT PRIMARY KEY,
    host VARCHAR(255),
    port INTEGER,
    security VARCHAR(32),
    username VARCHAR(320),
    password_encrypted TEXT,
    from_name VARCHAR(200),
    from_address VARCHAR(320),
    reply_to VARCHAR(320),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    configuration_version BIGINT NOT NULL DEFAULT 1,
    tested_at TIMESTAMPTZ,
    test_status VARCHAR(32) NOT NULL DEFAULT 'UNTESTED',
    last_error_code VARCHAR(200),
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_smtp_settings_singleton CHECK (id = 1),
    CONSTRAINT ck_smtp_settings_port CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
    CONSTRAINT ck_smtp_settings_security CHECK (
        security IS NULL OR security IN ('NONE', 'STARTTLS', 'TLS')
    ),
    CONSTRAINT ck_smtp_settings_test_status CHECK (
        test_status IN ('UNTESTED', 'TESTING', 'SUCCESS', 'FAILED')
    )
);

INSERT INTO smtp_settings (id, enabled, configuration_version, test_status, updated_at)
VALUES (1, FALSE, 1, 'UNTESTED', CURRENT_TIMESTAMP);
