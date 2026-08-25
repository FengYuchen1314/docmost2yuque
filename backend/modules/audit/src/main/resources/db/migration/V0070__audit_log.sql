CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    workspace_id UUID REFERENCES workspaces(id),
    actor_id UUID REFERENCES users(id),
    action VARCHAR(120) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id UUID,
    outcome VARCHAR(32) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_audit_events_outcome CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED'))
);

CREATE INDEX ix_audit_events_workspace_time
    ON audit_events (workspace_id, occurred_at DESC);

CREATE INDEX ix_audit_events_resource
    ON audit_events (resource_type, resource_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
