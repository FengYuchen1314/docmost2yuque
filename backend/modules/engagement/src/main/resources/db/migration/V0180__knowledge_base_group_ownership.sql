ALTER TABLE knowledge_base_user_groups
    ADD CONSTRAINT uq_kb_user_groups_id_user UNIQUE (id, user_id);

ALTER TABLE knowledge_base_user_group_items
    ADD COLUMN user_id UUID;

UPDATE knowledge_base_user_group_items item
SET user_id = groups.user_id
FROM knowledge_base_user_groups groups
WHERE groups.id = item.group_id;

ALTER TABLE knowledge_base_user_group_items
    ALTER COLUMN user_id SET NOT NULL,
    ADD CONSTRAINT fk_kb_group_items_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    ADD CONSTRAINT fk_kb_group_items_group_user
        FOREIGN KEY (group_id, user_id)
        REFERENCES knowledge_base_user_groups(id, user_id) ON DELETE CASCADE,
    ADD CONSTRAINT uq_kb_group_items_user_kb UNIQUE (user_id, knowledge_base_id);
