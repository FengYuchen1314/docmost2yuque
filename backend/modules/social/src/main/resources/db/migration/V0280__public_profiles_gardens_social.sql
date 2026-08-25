CREATE TABLE public_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    slug VARCHAR(80) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    bio VARCHAR(1000),
    avatar_url VARCHAR(2000),
    cover_url VARCHAR(2000),
    theme VARCHAR(32) NOT NULL DEFAULT 'PAPER',
    navigation JSONB NOT NULL DEFAULT '[]'::jsonb,
    seo_title VARCHAR(200),
    seo_description VARCHAR(500),
    discoverable BOOLEAN NOT NULL DEFAULT TRUE,
    rss_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_public_profiles_slug UNIQUE (slug),
    CONSTRAINT ck_public_profiles_theme CHECK (theme IN ('PAPER','MINIMAL','MAGAZINE','DARK'))
);

CREATE TABLE public_gardens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug VARCHAR(80) NOT NULL,
    title VARCHAR(160) NOT NULL,
    description VARCHAR(1000),
    icon VARCHAR(2000),
    cover_url VARCHAR(2000),
    theme VARCHAR(32) NOT NULL DEFAULT 'PAPER',
    navigation JSONB NOT NULL DEFAULT '[]'::jsonb,
    seo_title VARCHAR(200),
    seo_description VARCHAR(500),
    discoverable BOOLEAN NOT NULL DEFAULT TRUE,
    rss_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_public_gardens_slug UNIQUE (slug),
    CONSTRAINT ck_public_gardens_theme CHECK (theme IN ('PAPER','MINIMAL','MAGAZINE','DARK'))
);

CREATE TABLE garden_knowledge_bases (
    garden_id UUID NOT NULL REFERENCES public_gardens(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    position NUMERIC(30,15) NOT NULL,
    PRIMARY KEY (garden_id, knowledge_base_id)
);

CREATE TABLE social_follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(32) NOT NULL,
    target_id UUID NOT NULL,
    notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (follower_id,target_type,target_id),
    CONSTRAINT ck_social_follows_type CHECK (target_type IN ('USER','KNOWLEDGE_BASE','GARDEN'))
);
CREATE INDEX ix_social_follows_target ON social_follows(target_type,target_id,created_at DESC);

CREATE TABLE publication_reactions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    publication_id UUID NOT NULL REFERENCES page_publications(id) ON DELETE CASCADE,
    reaction_type VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id,publication_id,reaction_type),
    CONSTRAINT ck_publication_reactions_type CHECK (reaction_type IN ('LIKE','CLAP','HEART','INSIGHTFUL'))
);
CREATE INDEX ix_publication_reactions_publication ON publication_reactions(publication_id,reaction_type);

CREATE TABLE social_blocks (
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (blocker_id,blocked_id),
    CONSTRAINT ck_social_blocks_self CHECK (blocker_id<>blocked_id)
);

CREATE TABLE social_reports (
    id UUID PRIMARY KEY,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(32) NOT NULL,
    target_id UUID NOT NULL,
    reason VARCHAR(64) NOT NULL,
    details VARCHAR(2000),
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    resolution VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_social_reports_type CHECK (target_type IN ('USER','GARDEN','PUBLICATION')),
    CONSTRAINT ck_social_reports_status CHECK (status IN ('OPEN','REVIEWING','RESOLVED','DISMISSED'))
);
CREATE INDEX ix_social_reports_status ON social_reports(status,created_at);
