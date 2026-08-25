CREATE TABLE content_events (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    anonymous_visitor_hash VARCHAR(128),
    resource_type VARCHAR(32) NOT NULL,
    resource_id UUID NOT NULL,
    knowledge_base_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL,
    session_id VARCHAR(128),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_content_events_resource_type CHECK (resource_type IN ('PAGE', 'KNOWLEDGE_BASE')),
    CONSTRAINT ck_content_events_event_type CHECK (event_type IN ('VIEW', 'EDIT', 'COMMENT', 'SHARE', 'EXPORT', 'REACTION')),
    CONSTRAINT ck_content_events_visitor CHECK (actor_id IS NOT NULL OR anonymous_visitor_hash IS NOT NULL)
);

CREATE INDEX ix_content_events_resource_time
    ON content_events (workspace_id, resource_type, resource_id, occurred_at DESC);
CREATE INDEX ix_content_events_knowledge_base_time
    ON content_events (workspace_id, knowledge_base_id, occurred_at DESC)
    WHERE knowledge_base_id IS NOT NULL;

CREATE TABLE daily_content_metrics (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    resource_type VARCHAR(32) NOT NULL,
    resource_id UUID NOT NULL,
    metric_date DATE NOT NULL,
    views BIGINT NOT NULL DEFAULT 0,
    unique_views BIGINT NOT NULL DEFAULT 0,
    edits BIGINT NOT NULL DEFAULT 0,
    comments BIGINT NOT NULL DEFAULT 0,
    shares BIGINT NOT NULL DEFAULT 0,
    exports BIGINT NOT NULL DEFAULT 0,
    reactions BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (workspace_id, resource_type, resource_id, metric_date)
);

CREATE TABLE daily_metric_unique_visitors (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    resource_type VARCHAR(32) NOT NULL,
    resource_id UUID NOT NULL,
    metric_date DATE NOT NULL,
    visitor_key VARCHAR(160) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (workspace_id, resource_type, resource_id, metric_date, visitor_key)
);
