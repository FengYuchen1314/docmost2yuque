WITH inserted AS (
    INSERT INTO workspaces (
        id,
        workspace_type,
        name,
        default_visibility,
        default_publish_mode,
        created_by,
        created_at,
        updated_at
    )
    SELECT
        gen_random_uuid(),
        'PERSONAL',
        '我的空间',
        'PRIVATE',
        'MANUAL',
        users.id,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    FROM users
    WHERE NOT EXISTS (
        SELECT 1
        FROM workspaces existing
        WHERE existing.created_by = users.id
          AND existing.workspace_type = 'PERSONAL'
          AND existing.deleted_at IS NULL
    )
    RETURNING id, created_by
)
INSERT INTO workspace_memberships (
    workspace_id,
    user_id,
    role,
    created_at,
    updated_at
)
SELECT id, created_by, 'OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM inserted;

INSERT INTO workspace_memberships (
    workspace_id,
    user_id,
    role,
    created_at,
    updated_at
)
SELECT
    workspace.id,
    workspace.created_by,
    'OWNER',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM workspaces workspace
WHERE workspace.workspace_type = 'PERSONAL'
  AND workspace.deleted_at IS NULL
ON CONFLICT (workspace_id, user_id) DO UPDATE
SET role = 'OWNER', updated_at = EXCLUDED.updated_at;
