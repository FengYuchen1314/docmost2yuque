CREATE TABLE publication_attachments (
    publication_id UUID NOT NULL REFERENCES page_publications(id) ON DELETE CASCADE,
    attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    PRIMARY KEY (publication_id, attachment_id)
);

CREATE INDEX ix_publication_attachments_attachment
    ON publication_attachments (attachment_id, publication_id);

INSERT INTO publication_attachments(publication_id, attachment_id)
SELECT DISTINCT publication.id, CASE
    WHEN (card.data_json ->> 'attachmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN (card.data_json ->> 'attachmentId')::uuid END
FROM page_publications publication
JOIN page_card_instances card
  ON card.page_id = publication.page_id
 AND card.archived_at IS NULL
 AND card.page_revision_no = publication.source_draft_revision
JOIN attachments attachment
  ON attachment.id = CASE
       WHEN (card.data_json ->> 'attachmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       THEN (card.data_json ->> 'attachmentId')::uuid END
 AND attachment.page_id = publication.page_id
 AND attachment.deleted_at IS NULL
WHERE card.data_json ? 'attachmentId'
  AND (card.data_json ->> 'attachmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT DO NOTHING;
