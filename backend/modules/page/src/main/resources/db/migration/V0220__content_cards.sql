CREATE TABLE page_card_instances (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    card_id VARCHAR(64) NOT NULL,
    schema_version INTEGER NOT NULL,
    data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_pointer VARCHAR(500) NOT NULL,
    page_revision_no BIGINT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ,
    CONSTRAINT ck_page_card_instances_version CHECK (schema_version > 0),
    CONSTRAINT ck_page_card_instances_revision CHECK (page_revision_no >= 0)
);

CREATE UNIQUE INDEX uq_page_card_instances_pointer_active
    ON page_card_instances (page_id, source_pointer) WHERE archived_at IS NULL;

CREATE INDEX ix_page_card_instances_page_active
    ON page_card_instances (page_id, updated_at DESC) WHERE archived_at IS NULL;

CREATE TABLE user_card_usage (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id VARCHAR(64) NOT NULL,
    use_count BIGINT NOT NULL DEFAULT 1,
    last_used_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, card_id),
    CONSTRAINT ck_user_card_usage_count CHECK (use_count > 0)
);

CREATE INDEX ix_user_card_usage_recent
    ON user_card_usage (user_id, last_used_at DESC);

CREATE TABLE card_poll_votes (
    card_instance_id UUID NOT NULL REFERENCES page_card_instances(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    option_ids JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (card_instance_id, user_id)
);

CREATE TABLE card_checkins (
    card_instance_id UUID NOT NULL REFERENCES page_card_instances(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (card_instance_id, user_id, local_date)
);

CREATE INDEX ix_card_checkins_instance_date
    ON card_checkins (card_instance_id, local_date DESC);
