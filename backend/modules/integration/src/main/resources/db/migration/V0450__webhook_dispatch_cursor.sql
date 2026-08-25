ALTER TABLE webhook_subscriptions
    ADD COLUMN dispatch_cursor_at TIMESTAMPTZ,
    ADD COLUMN dispatch_cursor_id UUID;

COMMENT ON COLUMN webhook_subscriptions.dispatch_cursor_at IS
    'Last audit event timestamp scanned by the webhook enqueuer, including unmatched events';
COMMENT ON COLUMN webhook_subscriptions.dispatch_cursor_id IS
    'Tie-breaker for the last audit event scanned at dispatch_cursor_at';

CREATE INDEX ix_audit_events_webhook_scan
    ON audit_events(workspace_id, occurred_at, id)
    WHERE outcome = 'SUCCESS';
