CREATE TABLE workspace_user_groups (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_workspace_user_groups_identity UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX uq_workspace_user_groups_name_active
    ON workspace_user_groups (workspace_id, lower(name))
    WHERE deleted_at IS NULL;

CREATE INDEX ix_workspace_user_groups_active
    ON workspace_user_groups (workspace_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE workspace_user_group_members (
    group_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    added_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT fk_workspace_user_group_members_group
        FOREIGN KEY (group_id, workspace_id)
        REFERENCES workspace_user_groups(id, workspace_id) ON DELETE CASCADE,
    CONSTRAINT fk_workspace_user_group_members_membership
        FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX ix_workspace_user_group_members_user
    ON workspace_user_group_members (workspace_id, user_id, group_id);

ALTER TABLE acl_entries DROP CONSTRAINT ck_acl_subject_type;

ALTER TABLE acl_entries
    ADD CONSTRAINT ck_acl_subject_type CHECK (
        subject_type IN ('USER', 'GROUP', 'TEAM', 'PUBLIC', 'INVITE', 'API_CLIENT')
    );
