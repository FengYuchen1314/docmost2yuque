ALTER TABLE workspace_memberships
    ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

UPDATE workspace_memberships SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE workspace_memberships
    ALTER COLUMN updated_at SET NOT NULL;

CREATE UNIQUE INDEX uq_personal_workspace_per_owner
    ON workspaces (created_by)
    WHERE workspace_type = 'PERSONAL' AND deleted_at IS NULL;
