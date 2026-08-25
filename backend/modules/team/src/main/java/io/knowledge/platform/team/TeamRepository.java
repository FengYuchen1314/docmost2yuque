package io.knowledge.platform.team;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class TeamRepository {

    private static final Table<Record> TEAMS = table(name("teams"));
    private static final Table<Record> MEMBERS = table(name("team_members"));
    private static final Field<UUID> ID = field(name("id"), UUID.class);
    private static final Field<UUID> WORKSPACE_ID = field(name("workspace_id"), UUID.class);
    private static final Field<String> NAME = field(name("name"), String.class);
    private static final Field<String> SLUG = field(name("slug"), String.class);
    private static final Field<String> DESCRIPTION = field(name("description"), String.class);
    private static final Field<String> AVATAR = field(name("avatar"), String.class);
    private static final Field<String> VISIBILITY = field(name("visibility"), String.class);
    private static final Field<UUID> CREATED_BY = field(name("created_by"), UUID.class);
    private static final Field<OffsetDateTime> CREATED_AT =
            field(name("created_at"), OffsetDateTime.class);
    private static final Field<OffsetDateTime> UPDATED_AT =
            field(name("updated_at"), OffsetDateTime.class);
    private static final Field<OffsetDateTime> DELETED_AT =
            field(name("deleted_at"), OffsetDateTime.class);

    private final DSLContext dsl;

    TeamRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    void insert(TeamView team) {
        dsl.insertInto(TEAMS)
                .columns(
                        ID,
                        WORKSPACE_ID,
                        NAME,
                        SLUG,
                        DESCRIPTION,
                        AVATAR,
                        VISIBILITY,
                        CREATED_BY,
                        CREATED_AT,
                        UPDATED_AT)
                .values(
                        team.id(),
                        team.workspaceId(),
                        team.name(),
                        team.slug(),
                        team.description(),
                        team.avatar(),
                        team.visibility(),
                        team.createdBy(),
                        team.createdAt(),
                        team.updatedAt())
                .execute();
    }

    TeamView find(UUID teamId) {
        return selectActive().and(ID.eq(teamId)).fetchOne(TeamRepository::mapTeam);
    }

    boolean isOrganizationWorkspace(UUID workspaceId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("workspaces")))
                .where(field(name("id"), UUID.class)
                        .eq(workspaceId)
                        .and(field(name("workspace_type"), String.class).eq("ORGANIZATION"))
                        .and(field(name("deleted_at"), OffsetDateTime.class).isNull())));
    }

    List<TeamView> list(UUID workspaceId) {
        return selectActive()
                .and(WORKSPACE_ID.eq(workspaceId))
                .orderBy(NAME.asc(), ID.asc())
                .fetch(TeamRepository::mapTeam);
    }

    void update(TeamView team) {
        int changed = dsl.update(TEAMS)
                .set(NAME, team.name())
                .set(SLUG, team.slug())
                .set(DESCRIPTION, team.description())
                .set(AVATAR, team.avatar())
                .set(VISIBILITY, team.visibility())
                .set(UPDATED_AT, team.updatedAt())
                .where(ID.eq(team.id()).and(DELETED_AT.isNull()))
                .execute();
        requireChanged(changed);
    }

    void softDelete(UUID teamId, OffsetDateTime now) {
        int changed = dsl.update(TEAMS)
                .set(DELETED_AT, now)
                .set(UPDATED_AT, now)
                .where(ID.eq(teamId).and(DELETED_AT.isNull()))
                .execute();
        requireChanged(changed);
    }

    void addMember(UUID teamId, UUID userId, String role, OffsetDateTime now) {
        dsl.insertInto(MEMBERS)
                .columns(
                        field(name("team_id"), UUID.class),
                        field(name("user_id"), UUID.class),
                        field(name("role"), String.class),
                        CREATED_AT,
                        UPDATED_AT)
                .values(teamId, userId, role, now, now)
                .execute();
    }

    void updateMember(UUID teamId, UUID userId, String role, OffsetDateTime now) {
        int changed = dsl.update(MEMBERS)
                .set(field(name("role"), String.class), role)
                .set(UPDATED_AT, now)
                .where(field(name("team_id"), UUID.class)
                        .eq(teamId)
                        .and(field(name("user_id"), UUID.class).eq(userId)))
                .execute();
        requireChanged(changed);
    }

    void removeMember(UUID teamId, UUID userId) {
        int changed = dsl.deleteFrom(MEMBERS)
                .where(field(name("team_id"), UUID.class)
                        .eq(teamId)
                        .and(field(name("user_id"), UUID.class).eq(userId)))
                .execute();
        requireChanged(changed);
    }

    List<TeamMemberView> listMembers(UUID teamId) {
        return dsl.select(
                        field(name("tm", "user_id"), UUID.class),
                        field(name("u", "email_normalized"), String.class),
                        field(name("u", "display_name"), String.class),
                        field(name("tm", "role"), String.class),
                        field(name("tm", "created_at"), OffsetDateTime.class),
                        field(name("tm", "updated_at"), OffsetDateTime.class))
                .from(table(name("team_members")).as("tm"))
                .join(table(name("users")).as("u"))
                .on(field(name("u", "id"), UUID.class)
                        .eq(field(name("tm", "user_id"), UUID.class)))
                .where(field(name("tm", "team_id"), UUID.class).eq(teamId))
                .orderBy(field(name("tm", "role")).asc(), field(name("u", "email_normalized")).asc())
                .fetch(record -> new TeamMemberView(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        record.value5(),
                        record.value6()));
    }

    boolean isWorkspaceMember(UUID workspaceId, UUID userId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("workspace_memberships")))
                .where(field(name("workspace_id"), UUID.class)
                        .eq(workspaceId)
                        .and(field(name("user_id"), UUID.class).eq(userId))));
    }

    String memberRole(UUID teamId, UUID userId) {
        return dsl.select(field(name("role"), String.class))
                .from(MEMBERS)
                .where(field(name("team_id"), UUID.class)
                        .eq(teamId)
                        .and(field(name("user_id"), UUID.class).eq(userId)))
                .fetchOne(field(name("role"), String.class));
    }

    long managerCountForUpdate(UUID teamId) {
        dsl.selectOne().from(TEAMS).where(ID.eq(teamId)).forUpdate().fetchOne();
        return dsl.fetchCount(MEMBERS, field(name("team_id"), UUID.class)
                .eq(teamId)
                .and(field(name("role"), String.class).eq("MANAGER")));
    }

    boolean hasActiveKnowledgeBases(UUID teamId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("knowledge_bases")))
                .where(field(name("team_id"), UUID.class)
                        .eq(teamId)
                        .and(field(name("archived_at"), OffsetDateTime.class).isNull())));
    }

    private org.jooq.SelectConditionStep<? extends Record> selectActive() {
        return dsl.select(
                        ID,
                        WORKSPACE_ID,
                        NAME,
                        SLUG,
                        DESCRIPTION,
                        AVATAR,
                        VISIBILITY,
                        CREATED_BY,
                        CREATED_AT,
                        UPDATED_AT)
                .from(TEAMS)
                .where(DELETED_AT.isNull());
    }

    private static TeamView mapTeam(Record record) {
        return new TeamView(
                record.get(ID),
                record.get(WORKSPACE_ID),
                record.get(NAME),
                record.get(SLUG),
                record.get(DESCRIPTION),
                record.get(AVATAR),
                record.get(VISIBILITY),
                record.get(CREATED_BY),
                record.get(CREATED_AT),
                record.get(UPDATED_AT));
    }

    private static void requireChanged(int changed) {
        if (changed != 1) {
            throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
    }
}
