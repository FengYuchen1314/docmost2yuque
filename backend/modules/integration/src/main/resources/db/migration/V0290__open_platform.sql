CREATE TABLE api_keys (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(120) NOT NULL,
    key_prefix VARCHAR(24) NOT NULL UNIQUE,
    secret_hash BYTEA NOT NULL,
    scopes TEXT[] NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_api_keys_workspace ON api_keys(workspace_id,created_at DESC);

CREATE TABLE oauth_clients (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    owner_id UUID NOT NULL REFERENCES users(id),
    client_id VARCHAR(80) NOT NULL UNIQUE,
    client_secret_hash BYTEA,
    name VARCHAR(120) NOT NULL,
    redirect_uris TEXT[] NOT NULL,
    scopes TEXT[] NOT NULL,
    public_client BOOLEAN NOT NULL DEFAULT TRUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_oauth_clients_workspace ON oauth_clients(workspace_id,created_at DESC);

CREATE TABLE oauth_authorization_codes (
    id UUID PRIMARY KEY,
    code_hash BYTEA NOT NULL UNIQUE,
    client_id UUID NOT NULL REFERENCES oauth_clients(id),
    user_id UUID NOT NULL REFERENCES users(id),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    redirect_uri TEXT NOT NULL,
    scopes TEXT[] NOT NULL,
    code_challenge VARCHAR(128) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE oauth_token_families (
    id UUID PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES oauth_clients(id),
    user_id UUID NOT NULL REFERENCES users(id),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    scopes TEXT[] NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE oauth_access_tokens (
    id UUID PRIMARY KEY,
    token_hash BYTEA NOT NULL UNIQUE,
    family_id UUID REFERENCES oauth_token_families(id),
    client_id UUID NOT NULL REFERENCES oauth_clients(id),
    user_id UUID NOT NULL REFERENCES users(id),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    scopes TEXT[] NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE oauth_refresh_tokens (
    id UUID PRIMARY KEY,
    token_hash BYTEA NOT NULL UNIQUE,
    family_id UUID NOT NULL REFERENCES oauth_token_families(id),
    client_id UUID NOT NULL REFERENCES oauth_clients(id),
    user_id UUID NOT NULL REFERENCES users(id),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    scopes TEXT[] NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    replaced_by UUID REFERENCES oauth_refresh_tokens(id),
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE webhook_subscriptions (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    created_by UUID NOT NULL REFERENCES users(id),
    name VARCHAR(120) NOT NULL,
    endpoint_url TEXT NOT NULL,
    secret_encrypted TEXT NOT NULL,
    events TEXT[] NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    suspended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_webhooks_workspace ON webhook_subscriptions(workspace_id,created_at DESC);

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY,
    webhook_id UUID NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
    audit_event_id UUID NOT NULL REFERENCES audit_events(id),
    event_type VARCHAR(120) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(24) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    response_status INTEGER,
    last_error TEXT,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_webhook_delivery_event UNIQUE(webhook_id,audit_event_id),
    CONSTRAINT ck_webhook_delivery_status CHECK(status IN('PENDING','RETRYING','DELIVERED','DEAD'))
);
CREATE INDEX ix_webhook_deliveries_due ON webhook_deliveries(status,next_attempt_at);

CREATE TABLE integration_idempotency (
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    actor_id UUID NOT NULL REFERENCES users(id),
    endpoint VARCHAR(160) NOT NULL,
    idempotency_key VARCHAR(160) NOT NULL,
    request_hash BYTEA NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(workspace_id,actor_id,endpoint,idempotency_key)
);
