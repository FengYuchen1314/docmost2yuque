CREATE TABLE instance_settings (
    id SMALLINT PRIMARY KEY,
    initialized BOOLEAN NOT NULL DEFAULT FALSE,
    initialized_at TIMESTAMPTZ,
    initialized_by UUID REFERENCES users(id),
    registration_mode VARCHAR(32) NOT NULL DEFAULT 'CLOSED',
    auth_methods JSONB NOT NULL DEFAULT '{"password": true, "emailCode": false}'::jsonb,
    settings_version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_instance_settings_singleton CHECK (id = 1),
    CONSTRAINT ck_instance_registration_mode CHECK (
        registration_mode IN ('CLOSED', 'PUBLIC')
    )
);

INSERT INTO instance_settings (
    id,
    initialized,
    registration_mode,
    auth_methods,
    created_at,
    updated_at
) VALUES (
    1,
    FALSE,
    'CLOSED',
    '{"password": true, "emailCode": false}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
