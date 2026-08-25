ALTER TABLE invitations
    ADD COLUMN IF NOT EXISTS target_team_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS target_knowledge_base_roles JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE durable_jobs AS job
SET payload = jsonb_set(
        job.payload,
        '{tokenHash}',
        to_jsonb(invitation.token_hash::text),
        true)
FROM invitations AS invitation
WHERE job.job_type = 'invitation.send'
  AND job.status IN ('PENDING', 'RUNNING')
  AND job.payload ->> 'invitationId' = invitation.id::text
  AND NOT (job.payload ? 'tokenHash');
