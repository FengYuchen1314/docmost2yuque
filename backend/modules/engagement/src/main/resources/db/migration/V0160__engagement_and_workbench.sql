CREATE TABLE activity_events (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_type VARCHAR(32) NOT NULL,
    resource_id UUID NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_activity_resource_type CHECK (resource_type IN ('PAGE', 'KNOWLEDGE_BASE', 'QUICK_NOTE')),
    CONSTRAINT ck_activity_event_type CHECK (event_type IN ('VIEW', 'EDIT', 'COLLABORATE', 'CREATE'))
);

CREATE INDEX ix_activity_actor_recent
    ON activity_events (actor_id, event_type, occurred_at DESC);
CREATE INDEX ix_activity_resource_recent
    ON activity_events (workspace_id, resource_type, resource_id, occurred_at DESC);

CREATE TABLE favorites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    resource_type VARCHAR(32) NOT NULL,
    resource_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, resource_type, resource_id),
    CONSTRAINT ck_favorites_resource_type CHECK (resource_type IN ('PAGE', 'KNOWLEDGE_BASE', 'QUICK_NOTE'))
);

CREATE INDEX ix_favorites_user_recent ON favorites (user_id, created_at DESC);

CREATE TABLE comments (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    resource_type VARCHAR(32) NOT NULL,
    resource_id UUID NOT NULL,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    anchor JSONB NOT NULL DEFAULT '{}'::jsonb,
    body_json JSONB NOT NULL,
    plain_text TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_comments_resource_type CHECK (resource_type = 'PAGE'),
    CONSTRAINT ck_comments_status CHECK (status IN ('OPEN', 'RESOLVED'))
);

CREATE INDEX ix_comments_resource ON comments (resource_type, resource_id, created_at)
    WHERE deleted_at IS NULL;

CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    notification_type VARCHAR(64) NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    resource_type VARCHAR(32) NOT NULL,
    resource_id UUID NOT NULL,
    anchor JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    aggregation_key VARCHAR(240) NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX uq_notifications_unread_aggregate
    ON notifications (recipient_id, aggregation_key) WHERE read_at IS NULL;
CREATE INDEX ix_notifications_recipient ON notifications (recipient_id, read_at, updated_at DESC);

CREATE TABLE knowledge_base_user_groups (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    position VARCHAR(40) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_kb_user_groups_name UNIQUE (user_id, name)
);

CREATE TABLE knowledge_base_user_group_items (
    group_id UUID NOT NULL REFERENCES knowledge_base_user_groups(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    position VARCHAR(40) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, knowledge_base_id)
);
