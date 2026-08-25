CREATE TABLE teams (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(80) NOT NULL,
    description TEXT,
    avatar TEXT,
    visibility VARCHAR(32) NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_teams_visibility CHECK (visibility IN ('PRIVATE', 'WORKSPACE'))
);

CREATE UNIQUE INDEX uq_teams_workspace_slug_active
    ON teams (workspace_id, lower(slug)) WHERE deleted_at IS NULL;

CREATE INDEX ix_teams_workspace_active
    ON teams (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE team_members (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (team_id, user_id),
    CONSTRAINT ck_team_members_role CHECK (role IN ('MANAGER', 'MEMBER'))
);

CREATE INDEX ix_team_members_user
    ON team_members (user_id, team_id);
