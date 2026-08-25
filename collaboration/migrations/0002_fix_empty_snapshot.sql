ALTER TABLE collaboration_documents
    ALTER COLUMN snapshot SET DEFAULT '\x'::bytea;

UPDATE collaboration_documents
SET snapshot = '\x'::bytea
WHERE snapshot_sequence = 0
  AND snapshot = decode('5c78', 'hex');
