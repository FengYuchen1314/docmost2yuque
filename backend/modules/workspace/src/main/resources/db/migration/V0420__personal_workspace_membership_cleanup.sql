UPDATE invitations invitation
SET
    status = 'REVOKED',
    revoked_at = COALESCE(invitation.revoked_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
FROM workspaces workspace
WHERE invitation.workspace_id = workspace.id
  AND workspace.workspace_type = 'PERSONAL'
  AND invitation.status IN ('QUEUED', 'SENT', 'FAILED');

DELETE FROM workspace_memberships membership
USING workspaces workspace
WHERE membership.workspace_id = workspace.id
  AND workspace.workspace_type = 'PERSONAL'
  AND membership.user_id <> workspace.created_by;
