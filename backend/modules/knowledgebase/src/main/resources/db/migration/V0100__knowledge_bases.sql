CREATE TABLE knowledge_bases (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    icon TEXT,
    owner_type VARCHAR(32) NOT NULL,
    owner_id UUID NOT NULL,
    team_id UUID REFERENCES teams(id),
    homepage_page_id UUID,
    visibility VARCHAR(32) NOT NULL,
    allow_public_index BOOLEAN NOT NULL DEFAULT FALSE,
    publish_mode VARCHAR(32) NOT NULL,
    watermark_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    appearance_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    catalog_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    catalog_revision BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ,
    CONSTRAINT ck_knowledge_bases_owner_type CHECK (
        owner_type IN ('PERSONAL', 'TEAM', 'WORKSPACE')
    ),
    CONSTRAINT ck_knowledge_bases_owner_team CHECK (
        (owner_type = 'TEAM' AND team_id = owner_id)
        OR (owner_type <> 'TEAM' AND team_id IS NULL)
    ),
    CONSTRAINT ck_knowledge_bases_visibility CHECK (
        visibility IN ('PRIVATE', 'WORKSPACE', 'PUBLIC')
    ),
    CONSTRAINT ck_knowledge_bases_publish_mode CHECK (
        publish_mode IN ('MANUAL', 'AUTO')
    )
);

CREATE UNIQUE INDEX uq_knowledge_bases_workspace_slug_active
    ON knowledge_bases (workspace_id, lower(slug)) WHERE archived_at IS NULL;

CREATE INDEX ix_knowledge_bases_workspace_active
    ON knowledge_bases (workspace_id, updated_at DESC) WHERE archived_at IS NULL;

CREATE INDEX ix_knowledge_bases_team_active
    ON knowledge_bases (team_id, updated_at DESC)
    WHERE team_id IS NOT NULL AND archived_at IS NULL;

CREATE TABLE knowledge_base_members (
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (knowledge_base_id, user_id),
    CONSTRAINT ck_knowledge_base_members_role CHECK (
        role IN ('MANAGER', 'EDITOR', 'READER')
    )
);

CREATE INDEX ix_knowledge_base_members_user
    ON knowledge_base_members (user_id, knowledge_base_id);
