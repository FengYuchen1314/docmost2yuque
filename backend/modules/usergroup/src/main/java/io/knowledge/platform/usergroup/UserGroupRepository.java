package io.knowledge.platform.usergroup;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import io.knowledge.platform.authorization.ResourceNotFoundException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class UserGroupRepository {

    private static final Table<Record> GROUPS = table(name("workspace_user_groups"));
    private static final Table<Record> MEMBERS = table(name("workspace_user_group_members"));
    private final DSLContext dsl;

    UserGroupRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    void insert(
            UUID id,
            UUID workspaceId,
            String groupName,
            String description,
            UUID createdBy,
            OffsetDateTime now) {
        dsl.insertInto(GROUPS)
                .columns(
                        uuid("id"), uuid("workspace_id"), string("name"), string("description"),
                        uuid("created_by"), time("created_at"), time("updated_at"))
                .values(id, workspaceId, groupName, description, createdBy, now, now)
                .execute();
    }

    UserGroupView find(UUID groupId) {
        return select().and(uuid("g", "id").eq(groupId)).fetchOne(UserGroupRepository::map);
    }

    List<UserGroupView> list(UUID workspaceId) {
        return select()
                .and(uuid("g", "workspace_id").eq(workspaceId))
                .orderBy(string("g", "name").asc(), uuid("g", "id").asc())
                .fetch(UserGroupRepository::map);
    }

    void update(UUID groupId, String groupName, String description, OffsetDateTime now) {
        int changed = dsl.update(GROUPS)
                .set(string("name"), groupName)
                .set(string("description"), description)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(groupId).and(time("deleted_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    void softDelete(UUID groupId, OffsetDateTime now) {
        int changed = dsl.update(GROUPS)
                .set(time("deleted_at"), now)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(groupId).and(time("deleted_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    void addMember(
            UUID groupId,
            UUID workspaceId,
            UUID userId,
            UUID addedBy,
            OffsetDateTime now) {
        dsl.insertInto(MEMBERS)
                .columns(
                        uuid("group_id"), uuid("workspace_id"), uuid("user_id"),
                        uuid("added_by"), time("created_at"))
                .values(groupId, workspaceId, userId, addedBy, now)
                .execute();
    }

    void removeMember(UUID groupId, UUID userId) {
        int changed = dsl.deleteFrom(MEMBERS)
                .where(uuid("group_id").eq(groupId).and(uuid("user_id").eq(userId)))
                .execute();
        requireChanged(changed);
    }

    List<UserGroupMemberView> members(UUID groupId) {
        return dsl.select(
                        uuid("m", "user_id"),
                        string("u", "email_normalized"),
                        string("u", "display_name"),
                        string("wm", "role"),
                        uuid("m", "added_by"),
                        time("m", "created_at"))
                .from(MEMBERS.as("m"))
                .join(table(name("users")).as("u"))
                .on(uuid("u", "id").eq(uuid("m", "user_id")))
                .join(table(name("workspace_memberships")).as("wm"))
                .on(uuid("wm", "workspace_id")
                        .eq(uuid("m", "workspace_id"))
                        .and(uuid("wm", "user_id").eq(uuid("m", "user_id"))))
                .where(uuid("m", "group_id").eq(groupId))
                .orderBy(string("u", "email_normalized").asc())
                .fetch(record -> new UserGroupMemberView(
                        record.value1(), record.value2(), record.value3(),
                        record.value4(), record.value5(), record.value6()));
    }

    boolean workspaceMember(UUID workspaceId, UUID userId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("workspace_memberships")))
                .where(uuid("workspace_id").eq(workspaceId).and(uuid("user_id").eq(userId))));
    }

    private org.jooq.SelectConditionStep<? extends Record> select() {
        var memberCount = dsl.selectCount()
                .from(MEMBERS.as("member_count_source"))
                .where(uuid("member_count_source", "group_id").eq(uuid("g", "id")))
                .asField("member_count");
        return dsl.select(
                        uuid("g", "id"),
                        uuid("g", "workspace_id"),
                        string("g", "name"),
                        string("g", "description"),
                        memberCount,
                        uuid("g", "created_by"),
                        time("g", "created_at"),
                        time("g", "updated_at"))
                .from(GROUPS.as("g"))
                .where(time("g", "deleted_at").isNull());
    }

    private static UserGroupView map(Record record) {
        return new UserGroupView(
                record.get(uuid("g", "id")),
                record.get(uuid("g", "workspace_id")),
                record.get(string("g", "name")),
                record.get(string("g", "description")),
                record.get(field(name("member_count"), Integer.class)),
                record.get(uuid("g", "created_by")),
                record.get(time("g", "created_at")),
                record.get(time("g", "updated_at")));
    }

    private static org.jooq.Field<UUID> uuid(String value) {
        return field(name(value), UUID.class);
    }

    private static org.jooq.Field<UUID> uuid(String qualifier, String value) {
        return field(name(qualifier, value), UUID.class);
    }

    private static org.jooq.Field<String> string(String value) {
        return field(name(value), String.class);
    }

    private static org.jooq.Field<String> string(String qualifier, String value) {
        return field(name(qualifier, value), String.class);
    }

    private static org.jooq.Field<OffsetDateTime> time(String value) {
        return field(name(value), OffsetDateTime.class);
    }

    private static org.jooq.Field<OffsetDateTime> time(String qualifier, String value) {
        return field(name(qualifier, value), OffsetDateTime.class);
    }

    private static void requireChanged(int changed) {
        if (changed != 1) throw new ResourceNotFoundException();
    }
}
