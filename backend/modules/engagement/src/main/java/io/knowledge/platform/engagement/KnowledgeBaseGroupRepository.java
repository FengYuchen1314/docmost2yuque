package io.knowledge.platform.engagement;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class KnowledgeBaseGroupRepository {

    private static final Table<Record> GROUPS = table(name("knowledge_base_user_groups"));
    private static final Table<Record> ITEMS = table(name("knowledge_base_user_group_items"));
    private final DSLContext dsl;

    KnowledgeBaseGroupRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    List<KnowledgeBaseGroupView> list(UUID userId, UUID workspaceId) {
        return dsl.select(
                        field(name("g", "id"), UUID.class),
                        field(name("g", "workspace_id"), UUID.class),
                        field(name("g", "name"), String.class),
                        field(name("g", "position"), String.class),
                        field(name("g", "created_at"), OffsetDateTime.class),
                        field(name("g", "updated_at"), OffsetDateTime.class))
                .from(table(name("knowledge_base_user_groups")).as("g"))
                .where(field(name("g", "user_id"), UUID.class).eq(userId)
                        .and(field(name("g", "workspace_id"), UUID.class).eq(workspaceId)))
                .orderBy(field(name("g", "position")).asc(), field(name("g", "id")).asc())
                .fetch(record -> group(record, items(record.get(field(name("g", "id"), UUID.class)))));
    }

    KnowledgeBaseGroupView find(UUID groupId, UUID userId) {
        return dsl.select(
                        field(name("g", "id"), UUID.class),
                        field(name("g", "workspace_id"), UUID.class),
                        field(name("g", "name"), String.class),
                        field(name("g", "position"), String.class),
                        field(name("g", "created_at"), OffsetDateTime.class),
                        field(name("g", "updated_at"), OffsetDateTime.class))
                .from(table(name("knowledge_base_user_groups")).as("g"))
                .where(field(name("g", "id"), UUID.class).eq(groupId)
                        .and(field(name("g", "user_id"), UUID.class).eq(userId)))
                .fetchOne(record -> group(record, items(groupId)));
    }

    void insertGroup(
            UUID id, UUID workspaceId, UUID userId, String groupName,
            String position, OffsetDateTime now) {
        dsl.insertInto(GROUPS)
                .columns(
                        uuid("id"), uuid("workspace_id"), uuid("user_id"), string("name"),
                        string("position"), time("created_at"), time("updated_at"))
                .values(id, workspaceId, userId, groupName, position, now, now)
                .execute();
    }

    boolean rename(UUID groupId, UUID userId, String groupName, OffsetDateTime now) {
        return dsl.update(GROUPS)
                        .set(string("name"), groupName)
                        .set(time("updated_at"), now)
                        .where(uuid("id").eq(groupId).and(uuid("user_id").eq(userId)))
                        .execute()
                == 1;
    }

    boolean delete(UUID groupId, UUID userId) {
        return dsl.deleteFrom(GROUPS)
                        .where(uuid("id").eq(groupId).and(uuid("user_id").eq(userId)))
                        .execute()
                == 1;
    }

    String nextGroupPosition(UUID userId, UUID workspaceId) {
        String last = dsl.select(string("position"))
                .from(GROUPS)
                .where(uuid("user_id").eq(userId).and(uuid("workspace_id").eq(workspaceId)))
                .orderBy(string("position").desc())
                .limit(1)
                .fetchOne(string("position"));
        return next(last);
    }

    void reorderGroups(UUID userId, UUID workspaceId, List<UUID> ids, OffsetDateTime now) {
        for (int index = 0; index < ids.size(); index++) {
            int changed = dsl.update(GROUPS)
                    .set(string("position"), rank(index))
                    .set(time("updated_at"), now)
                    .where(uuid("id").eq(ids.get(index))
                            .and(uuid("user_id").eq(userId))
                            .and(uuid("workspace_id").eq(workspaceId)))
                    .execute();
            if (changed != 1) throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
    }

    void moveItem(
            UUID userId, UUID groupId, UUID knowledgeBaseId, String position, OffsetDateTime now) {
        dsl.deleteFrom(ITEMS)
                .where(uuid("user_id").eq(userId).and(uuid("knowledge_base_id").eq(knowledgeBaseId)))
                .execute();
        dsl.insertInto(ITEMS)
                .columns(
                        uuid("group_id"), uuid("knowledge_base_id"), uuid("user_id"),
                        string("position"), time("created_at"))
                .values(groupId, knowledgeBaseId, userId, position, now)
                .execute();
    }

    void removeItem(UUID userId, UUID knowledgeBaseId) {
        dsl.deleteFrom(ITEMS)
                .where(uuid("user_id").eq(userId).and(uuid("knowledge_base_id").eq(knowledgeBaseId)))
                .execute();
    }

    String nextItemPosition(UUID groupId) {
        String last = dsl.select(string("position"))
                .from(ITEMS)
                .where(uuid("group_id").eq(groupId))
                .orderBy(string("position").desc())
                .limit(1)
                .fetchOne(string("position"));
        return next(last);
    }

    void reorderItems(UUID userId, UUID groupId, List<UUID> knowledgeBaseIds) {
        for (int index = 0; index < knowledgeBaseIds.size(); index++) {
            int changed = dsl.update(ITEMS)
                    .set(string("position"), rank(index))
                    .where(uuid("group_id").eq(groupId)
                            .and(uuid("user_id").eq(userId))
                            .and(uuid("knowledge_base_id").eq(knowledgeBaseIds.get(index))))
                    .execute();
            if (changed != 1) throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
    }

    List<UUID> groupIds(UUID userId, UUID workspaceId) {
        return dsl.select(uuid("id"))
                .from(GROUPS)
                .where(uuid("user_id").eq(userId).and(uuid("workspace_id").eq(workspaceId)))
                .fetch(uuid("id"));
    }

    List<UUID> itemIds(UUID userId, UUID groupId) {
        return dsl.select(uuid("knowledge_base_id"))
                .from(ITEMS)
                .where(uuid("user_id").eq(userId).and(uuid("group_id").eq(groupId)))
                .fetch(uuid("knowledge_base_id"));
    }

    private List<KnowledgeBaseGroupItemView> items(UUID groupId) {
        return dsl.select(
                        field(name("kb", "id"), UUID.class).as("knowledge_base_id"),
                        field(name("kb", "name"), String.class).as("knowledge_base_name"),
                        field(name("kb", "icon"), String.class).as("knowledge_base_icon"),
                        field(name("kb", "visibility"), String.class).as("knowledge_base_visibility"),
                        field(name("kb", "owner_type"), String.class).as("knowledge_base_owner_type"),
                        field(name("i", "position"), String.class).as("item_position"))
                .from(table(name("knowledge_base_user_group_items")).as("i"))
                .join(table(name("knowledge_bases")).as("kb"))
                .on(field(name("kb", "id"), UUID.class)
                        .eq(field(name("i", "knowledge_base_id"), UUID.class)))
                .where(field(name("i", "group_id"), UUID.class).eq(groupId))
                .orderBy(field(name("i", "position")).asc())
                .fetch(record -> new KnowledgeBaseGroupItemView(
                        record.get(field(name("knowledge_base_id"), UUID.class)),
                        record.get(field(name("knowledge_base_name"), String.class)),
                        record.get(field(name("knowledge_base_icon"), String.class)),
                        record.get(field(name("knowledge_base_visibility"), String.class)),
                        record.get(field(name("knowledge_base_owner_type"), String.class)),
                        record.get(field(name("item_position"), String.class))));
    }

    private static KnowledgeBaseGroupView group(
            Record record, List<KnowledgeBaseGroupItemView> items) {
        return new KnowledgeBaseGroupView(
                record.get(field(name("g", "id"), UUID.class)),
                record.get(field(name("g", "workspace_id"), UUID.class)),
                record.get(field(name("g", "name"), String.class)),
                record.get(field(name("g", "position"), String.class)),
                items,
                record.get(field(name("g", "created_at"), OffsetDateTime.class)),
                record.get(field(name("g", "updated_at"), OffsetDateTime.class)));
    }

    private static String next(String current) {
        if (current == null) return rank(0);
        long value = Long.parseLong(current);
        return String.format("%020d", value + 1024);
    }

    private static String rank(int index) {
        return String.format("%020d", (long) (index + 1) * 1024);
    }

    private static org.jooq.Field<UUID> uuid(String value) { return field(name(value), UUID.class); }
    private static org.jooq.Field<String> string(String value) { return field(name(value), String.class); }
    private static org.jooq.Field<OffsetDateTime> time(String value) { return field(name(value), OffsetDateTime.class); }
}
