ALTER TABLE pages
    ADD COLUMN label_revision BIGINT NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_pages_label_revision CHECK (label_revision >= 0);

CREATE TABLE page_labels (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    normalized_name VARCHAR(50) NOT NULL,
    color VARCHAR(7) NOT NULL,
    position INTEGER NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_page_labels_page_name UNIQUE (page_id, normalized_name),
    CONSTRAINT uq_page_labels_page_position UNIQUE (page_id, position),
    CONSTRAINT ck_page_labels_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT ck_page_labels_position CHECK (position BETWEEN 0 AND 19)
);

CREATE INDEX ix_page_labels_workspace_name
    ON page_labels (workspace_id, normalized_name);
