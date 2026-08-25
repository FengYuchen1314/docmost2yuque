package io.knowledge.platform.workspace;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class WorkspaceRepository {

    private static final Table<org.jooq.Record> WORKSPACES = table(name("workspaces"));
    private static final Table<org.jooq.Record> MEMBERSHIPS =
            table(name("workspace_memberships"));

    private final DSLContext dsl;

    WorkspaceRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    void lockUser(UUID userId) {
        org.jooq.Record record = dsl.select(field(name("id"), UUID.class))
                .from(table(name("users")))
                .where(field(name("id"), UUID.class).eq(userId))
                .forUpdate()
                .fetchOne();
        if (record == null) {
            throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
    }

    ProvisionedWorkspace personalWorkspace(UUID ownerId) {
        return dsl.select(
                        field(name("id"), UUID.class),
                        field(name("name"), String.class))
                .from(WORKSPACES)
                .where(field(name("created_by"), UUID.class)
                        .eq(ownerId)
                        .and(field(name("workspace_type"), String.class).eq("PERSONAL"))
                        .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                .fetchOne(record -> new ProvisionedWorkspace(record.value1(), record.value2()));
    }

    String activeWorkspaceType(UUID workspaceId) {
        return dsl.select(field(name("workspace_type"), String.class))
                .from(WORKSPACES)
                .where(field(name("id"), UUID.class)
                        .eq(workspaceId)
                        .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                .fetchOne(field(name("workspace_type"), String.class));
    }

    void insertWorkspace(
            UUID workspaceId,
            UUID ownerId,
            String workspaceType,
            String nameValue,
            OffsetDateTime now) {
        dsl.insertInto(WORKSPACES)
                .columns(
                        field(name("id"), UUID.class),
                        field(name("workspace_type"), String.class),
                        field(name("name"), String.class),
                        field(name("created_by"), UUID.class),
                        field(name("created_at"), OffsetDateTime.class),
                        field(name("updated_at"), OffsetDateTime.class))
                .values(workspaceId, workspaceType, nameValue, ownerId, now, now)
                .execute();

        dsl.insertInto(MEMBERSHIPS)
                .columns(
                        field(name("workspace_id"), UUID.class),
                        field(name("user_id"), UUID.class),
                        field(name("role"), String.class),
                        field(name("created_at"), OffsetDateTime.class),
                        field(name("updated_at"), OffsetDateTime.class))
                .values(workspaceId, ownerId, "OWNER", now, now)
                .execute();
    }

    void insertMemberIfAbsent(
            UUID workspaceId,
            UUID userId,
            String role,
            OffsetDateTime now) {
        dsl.insertInto(MEMBERSHIPS)
                .columns(
                        field(name("workspace_id"), UUID.class),
                        field(name("user_id"), UUID.class),
                        field(name("role"), String.class),
                        field(name("created_at"), OffsetDateTime.class),
                        field(name("updated_at"), OffsetDateTime.class))
                .values(workspaceId, userId, role, now, now)
                .onConflict(
                        field(name("workspace_id"), UUID.class),
                        field(name("user_id"), UUID.class))
                .doNothing()
                .execute();
    }

    List<WorkspaceView> listForUser(UUID userId) {
        return dsl.select(
                        field(name("w", "id"), UUID.class),
                        field(name("w", "workspace_type"), String.class),
                        field(name("w", "name"), String.class),
                        field(name("w", "default_visibility"), String.class),
                        field(name("w", "default_publish_mode"), String.class),
                        field(name("wm", "role"), String.class),
                        field(name("w", "created_by"), UUID.class),
                        field(name("w", "created_at"), OffsetDateTime.class),
                        field(name("w", "updated_at"), OffsetDateTime.class))
                .from(table(name("workspaces")).as("w"))
                .join(table(name("workspace_memberships")).as("wm"))
                .on(field(name("wm", "workspace_id"), UUID.class)
                        .eq(field(name("w", "id"), UUID.class)))
                .where(field(name("wm", "user_id"), UUID.class)
                        .eq(userId)
                        .and(field(name("w", "deleted_at"), OffsetDateTime.class).isNull()))
                .orderBy(field(name("w", "workspace_type")).desc(), field(name("w", "name")).asc())
                .fetch(record -> new WorkspaceView(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        record.value5(),
                        record.value6(),
                        record.value7(),
                        record.value8(),
                        record.value9()));
    }

    WorkspaceView findForUser(UUID workspaceId, UUID userId) {
        return listForUser(userId).stream()
                .filter(workspace -> workspace.id().equals(workspaceId))
                .findFirst()
                .orElse(null);
    }

    void updateSettings(
            UUID workspaceId,
            String workspaceName,
            String defaultVisibility,
            String defaultPublishMode,
            OffsetDateTime now) {
        int changed = dsl.update(WORKSPACES)
                .set(field(name("name"), String.class), workspaceName)
                .set(field(name("default_visibility"), String.class), defaultVisibility)
                .set(field(name("default_publish_mode"), String.class), defaultPublishMode)
                .set(field(name("updated_at"), OffsetDateTime.class), now)
                .where(field(name("id"), UUID.class)
                        .eq(workspaceId)
                        .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                .execute();
        requireChanged(changed);
    }

    List<WorkspaceMemberView> members(UUID workspaceId) {
        return dsl.select(
                        field(name("wm", "user_id"), UUID.class),
                        field(name("u", "email_normalized"), String.class),
                        field(name("u", "display_name"), String.class),
                        field(name("wm", "role"), String.class),
                        field(name("wm", "created_at"), OffsetDateTime.class),
                        field(name("wm", "updated_at"), OffsetDateTime.class))
                .from(table(name("workspace_memberships")).as("wm"))
                .join(table(name("users")).as("u"))
                .on(field(name("u", "id"), UUID.class)
                        .eq(field(name("wm", "user_id"), UUID.class)))
                .where(field(name("wm", "workspace_id"), UUID.class).eq(workspaceId))
                .orderBy(field(name("wm", "role")).asc(), field(name("u", "email_normalized")).asc())
                .fetch(record -> new WorkspaceMemberView(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        record.value5(),
                        record.value6()));
    }

    String membershipRole(UUID workspaceId, UUID userId) {
        return dsl.select(field(name("role"), String.class))
                .from(MEMBERSHIPS)
                .where(field(name("workspace_id"), UUID.class)
                        .eq(workspaceId)
                        .and(field(name("user_id"), UUID.class).eq(userId)))
                .fetchOne(field(name("role"), String.class));
    }

    long ownerCountForUpdate(UUID workspaceId) {
        dsl.selectOne()
                .from(WORKSPACES)
                .where(field(name("id"), UUID.class).eq(workspaceId))
                .forUpdate()
                .fetchOne();
        return dsl.fetchCount(
                MEMBERSHIPS,
                field(name("workspace_id"), UUID.class)
                        .eq(workspaceId)
                        .and(field(name("role"), String.class).eq("OWNER")));
    }

    void updateMemberRole(
            UUID workspaceId,
            UUID userId,
            String role,
            OffsetDateTime now) {
        int changed = dsl.update(MEMBERSHIPS)
                .set(field(name("role"), String.class), role)
                .set(field(name("updated_at"), OffsetDateTime.class), now)
                .where(field(name("workspace_id"), UUID.class)
                        .eq(workspaceId)
                        .and(field(name("user_id"), UUID.class).eq(userId)))
                .execute();
        requireChanged(changed);
    }

    void removeMember(UUID workspaceId, UUID userId) {
        int changed = dsl.deleteFrom(MEMBERSHIPS)
                .where(field(name("workspace_id"), UUID.class)
                        .eq(workspaceId)
                        .and(field(name("user_id"), UUID.class).eq(userId)))
                .execute();
        requireChanged(changed);
    }

    WorkspaceOwnershipTarget ownershipTargetForUpdate(
            UUID workspaceId, UUID actorId, UUID targetUserId) {
        return dsl.select(
                        field(name("w", "workspace_type"), String.class),
                        field(name("w", "name"), String.class),
                        field(name("actor_membership", "role"), String.class),
                        field(name("target_membership", "role"), String.class),
                        field(name("target_user", "status"), String.class))
                .from(table(name("workspaces")).as("w"))
                .join(table(name("workspace_memberships")).as("actor_membership"))
                .on(field(name("actor_membership", "workspace_id"), UUID.class)
                        .eq(field(name("w", "id"), UUID.class))
                        .and(field(name("actor_membership", "user_id"), UUID.class).eq(actorId)))
                .join(table(name("workspace_memberships")).as("target_membership"))
                .on(field(name("target_membership", "workspace_id"), UUID.class)
                        .eq(field(name("w", "id"), UUID.class))
                        .and(field(name("target_membership", "user_id"), UUID.class)
                                .eq(targetUserId)))
                .join(table(name("users")).as("target_user"))
                .on(field(name("target_user", "id"), UUID.class).eq(targetUserId))
                .where(field(name("w", "id"), UUID.class)
                        .eq(workspaceId)
                        .and(field(name("w", "deleted_at"), OffsetDateTime.class).isNull()))
                .forUpdate()
                .fetchOne(record -> new WorkspaceOwnershipTarget(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        record.value5()));
    }

    WorkspaceArchiveTarget archiveTargetForUpdate(UUID workspaceId, UUID actorId) {
        return dsl.select(
                        field(name("w", "id"), UUID.class),
                        field(name("w", "workspace_type"), String.class),
                        field(name("w", "name"), String.class),
                        field(name("wm", "role"), String.class))
                .from(table(name("workspaces")).as("w"))
                .join(table(name("workspace_memberships")).as("wm"))
                .on(field(name("wm", "workspace_id"), UUID.class)
                        .eq(field(name("w", "id"), UUID.class)))
                .where(field(name("w", "id"), UUID.class).eq(workspaceId)
                        .and(field(name("wm", "user_id"), UUID.class).eq(actorId))
                        .and(field(name("w", "deleted_at"), OffsetDateTime.class).isNull()))
                .forUpdate()
                .fetchOne(record -> new WorkspaceArchiveTarget(
                        record.value1(), record.value2(), record.value3(), record.value4()));
    }

    void archive(UUID workspaceId, OffsetDateTime now) {
        int changed = dsl.update(WORKSPACES)
                .set(field(name("deleted_at"), OffsetDateTime.class), now)
                .set(field(name("updated_at"), OffsetDateTime.class), now)
                .where(field(name("id"), UUID.class).eq(workspaceId)
                        .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                .execute();
        requireChanged(changed);
    }

    private static void requireChanged(int changed) {
        if (changed != 1) {
            throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
    }

    record WorkspaceArchiveTarget(
            UUID workspaceId, String workspaceType, String name, String membershipRole) {}

    record WorkspaceOwnershipTarget(
            String workspaceType,
            String workspaceName,
            String actorRole,
            String targetRole,
            String targetStatus) {}
}
