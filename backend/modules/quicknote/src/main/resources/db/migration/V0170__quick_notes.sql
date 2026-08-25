CREATE TABLE quick_notes (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_json JSONB NOT NULL,
    plain_text TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    source VARCHAR(32) NOT NULL DEFAULT 'QUICK_NOTE_PAGE',
    revision_no BIGINT NOT NULL DEFAULT 1,
    client_request_id UUID,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_quick_notes_status CHECK (status IN ('ACTIVE', 'ARCHIVED', 'DELETED')),
    CONSTRAINT ck_quick_notes_source CHECK (source IN ('HOME', 'QUICK_NOTE_PAGE', 'API', 'IMPORT')),
    CONSTRAINT ck_quick_notes_revision CHECK (revision_no > 0),
    CONSTRAINT uq_quick_notes_client_request UNIQUE (user_id, client_request_id)
);

CREATE INDEX ix_quick_notes_user_status_updated
    ON quick_notes (user_id, status, updated_at DESC);
CREATE INDEX ix_quick_notes_workspace_user
    ON quick_notes (workspace_id, user_id);

CREATE TABLE quick_note_revisions (
    id UUID PRIMARY KEY,
    quick_note_id UUID NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
    revision_no BIGINT NOT NULL,
    revision_kind VARCHAR(32) NOT NULL,
    content_json JSONB NOT NULL,
    plain_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_quick_note_revision UNIQUE (quick_note_id, revision_no),
    CONSTRAINT ck_quick_note_revision_kind CHECK (
        revision_kind IN ('CREATE', 'AUTO_SAVE', 'COMMIT', 'RESTORE')
    )
);

CREATE INDEX ix_quick_note_revisions_note
    ON quick_note_revisions (quick_note_id, revision_no DESC);

CREATE TABLE quick_note_tags (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    color VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX uq_quick_note_tags_user_name
    ON quick_note_tags (user_id, lower(name));

CREATE TABLE quick_note_tag_links (
    quick_note_id UUID NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES quick_note_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (quick_note_id, tag_id)
);

CREATE TABLE quick_note_conversions (
    quick_note_id UUID NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    converted_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (quick_note_id, page_id)
);

CREATE INDEX ix_quick_note_conversions_page ON quick_note_conversions (page_id);
