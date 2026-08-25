CREATE OR REPLACE FUNCTION protect_publication_snapshot()
RETURNS TRIGGER AS $$
DECLARE
    merge_relocation_enabled BOOLEAN :=
        current_setting('knowledge_platform.knowledge_base_merge_relocation', TRUE) = 'on';
BEGIN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.page_id IS DISTINCT FROM OLD.page_id
       OR NEW.source_history_id IS DISTINCT FROM OLD.source_history_id
       OR NEW.source_draft_revision IS DISTINCT FROM OLD.source_draft_revision
       OR NEW.content_type IS DISTINCT FROM OLD.content_type
       OR NEW.title_snapshot IS DISTINCT FROM OLD.title_snapshot
       OR NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
       OR NEW.binary_snapshot IS DISTINCT FROM OLD.binary_snapshot
       OR NEW.plain_text_snapshot IS DISTINCT FROM OLD.plain_text_snapshot
       OR NEW.metadata_snapshot IS DISTINCT FROM OLD.metadata_snapshot
       OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
       OR NEW.published_by IS DISTINCT FROM OLD.published_by
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR (NEW.knowledge_base_id IS DISTINCT FROM OLD.knowledge_base_id
           AND NOT merge_relocation_enabled) THEN
        RAISE EXCEPTION 'publication snapshots are immutable';
    END IF;

    IF NEW.knowledge_base_id IS DISTINCT FROM OLD.knowledge_base_id
       AND (
           NOT EXISTS (
               SELECT 1
               FROM pages p
               WHERE p.id = NEW.page_id
                 AND p.workspace_id = NEW.workspace_id
                 AND p.knowledge_base_id = NEW.knowledge_base_id
           )
           OR NOT EXISTS (
               SELECT 1
               FROM knowledge_bases source_kb
               JOIN knowledge_bases target_kb
                 ON target_kb.id = NEW.knowledge_base_id
                AND target_kb.workspace_id = source_kb.workspace_id
               WHERE source_kb.id = OLD.knowledge_base_id
                 AND source_kb.workspace_id = NEW.workspace_id
           )
       ) THEN
        RAISE EXCEPTION 'invalid publication knowledge-base relocation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION relocate_page_publications_for_merge(
    source_knowledge_base_id UUID,
    target_knowledge_base_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    source_workspace_id UUID;
    target_workspace_id UUID;
    moved_count INTEGER;
BEGIN
    IF source_knowledge_base_id = target_knowledge_base_id THEN
        RAISE EXCEPTION 'source and target knowledge bases must differ';
    END IF;

    SELECT workspace_id
    INTO STRICT source_workspace_id
    FROM knowledge_bases
    WHERE id = source_knowledge_base_id
    FOR SHARE;

    SELECT workspace_id
    INTO STRICT target_workspace_id
    FROM knowledge_bases
    WHERE id = target_knowledge_base_id
      AND archived_at IS NULL
    FOR SHARE;

    IF source_workspace_id IS DISTINCT FROM target_workspace_id THEN
        RAISE EXCEPTION 'publication relocation must remain in one workspace';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM page_publications publication
        JOIN pages page ON page.id = publication.page_id
        WHERE publication.knowledge_base_id = source_knowledge_base_id
          AND (
              page.workspace_id IS DISTINCT FROM source_workspace_id
              OR page.knowledge_base_id IS DISTINCT FROM target_knowledge_base_id
          )
    ) THEN
        RAISE EXCEPTION 'publication pages must be relocated before their snapshots';
    END IF;

    PERFORM set_config(
        'knowledge_platform.knowledge_base_merge_relocation',
        'on',
        TRUE
    );
    UPDATE page_publications
    SET knowledge_base_id = target_knowledge_base_id
    WHERE knowledge_base_id = source_knowledge_base_id;
    GET DIAGNOSTICS moved_count = ROW_COUNT;
    PERFORM set_config(
        'knowledge_platform.knowledge_base_merge_relocation',
        'off',
        TRUE
    );
    RETURN moved_count;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION relocate_page_publications_for_merge(UUID, UUID) FROM PUBLIC;
