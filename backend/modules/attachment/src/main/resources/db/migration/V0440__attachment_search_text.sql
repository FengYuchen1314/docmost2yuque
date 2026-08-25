ALTER TABLE attachments
    ADD COLUMN extracted_text TEXT NOT NULL DEFAULT '',
    ADD COLUMN extraction_status VARCHAR(32) NOT NULL DEFAULT 'METADATA_ONLY',
    ADD COLUMN extracted_at TIMESTAMPTZ;

ALTER TABLE attachments
    ADD CONSTRAINT ck_attachments_extraction_status CHECK (
        extraction_status IN ('EXTRACTED', 'EMPTY', 'UNSUPPORTED', 'TOO_LARGE', 'FAILED', 'METADATA_ONLY')
    );
