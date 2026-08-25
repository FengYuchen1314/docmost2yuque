package io.knowledge.platform.knowledgebase;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class KnowledgeBaseRepository {

    private static final Table<Record> KNOWLEDGE_BASES = table(name("knowledge_bases"));
    private static final Table<Record> MEMBERS = table(name("knowledge_base_members"));
    private final DSLContext dsl;

    KnowledgeBaseRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    void insert(KnowledgeBaseView knowledgeBase) {
        dsl.insertInto(KNOWLEDGE_BASES)
                .columns(
                        fUuid("id"),
                        fUuid("workspace_id"),
                        fString("name"),
                        fString("slug"),
                        fString("description"),
                        fString("icon"),
                        fString("owner_type"),
                        fUuid("owner_id"),
                        fUuid("team_id"),
                        fString("visibility"),
                        field(name("allow_public_index"), Boolean.class),
                        fString("publish_mode"),
                        fUuid("created_by"),
                        fTime("created_at"),
                        fTime("updated_at"))
                .values(
                        knowledgeBase.id(),
                        knowledgeBase.workspaceId(),
                        knowledgeBase.name(),
                        knowledgeBase.slug(),
                        knowledgeBase.description(),
                        knowledgeBase.icon(),
                        knowledgeBase.ownerType(),
                        knowledgeBase.ownerId(),
                        knowledgeBase.teamId(),
                        knowledgeBase.visibility(),
                        knowledgeBase.allowPublicIndex(),
                        knowledgeBase.publishMode(),
                        knowledgeBase.createdBy(),
                        knowledgeBase.createdAt(),
                        knowledgeBase.updatedAt())
                .execute();
    }

    KnowledgeBaseView find(UUID id) {
        return selectActive()
                .and(fUuid("id").eq(id))
                .fetchOne(KnowledgeBaseRepository::map);
    }

    List<KnowledgeBaseView> list(UUID workspaceId) {
        return selectActive()
                .and(fUuid("workspace_id").eq(workspaceId))
                .orderBy(fString("name").asc(), fUuid("id").asc())
                .fetch(KnowledgeBaseRepository::map);
    }

    void update(KnowledgeBaseView value) {
        int changed = dsl.update(KNOWLEDGE_BASES)
                .set(fString("name"), value.name())
                .set(fString("slug"), value.slug())
                .set(fString("description"), value.description())
                .set(fString("icon"), value.icon())
                .set(fUuid("homepage_page_id"), value.homepagePageId())
                .set(fString("visibility"), value.visibility())
                .set(field(name("allow_public_index"), Boolean.class), value.allowPublicIndex())
                .set(fString("publish_mode"), value.publishMode())
                .set(field(name("watermark_config"), JSONB.class), JSONB.valueOf(value.watermarkConfig()))
                .set(field(name("appearance_config"), JSONB.class), JSONB.valueOf(value.appearanceConfig()))
                .set(field(name("catalog_config"), JSONB.class), JSONB.valueOf(value.catalogConfig()))
                .set(fTime("updated_at"), value.updatedAt())
                .where(fUuid("id").eq(value.id()).and(fTime("archived_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    void transfer(
            UUID id,
            String ownerType,
            UUID ownerId,
            UUID teamId,
            OffsetDateTime now) {
        int changed = dsl.update(KNOWLEDGE_BASES)
                .set(fString("owner_type"), ownerType)
                .set(fUuid("owner_id"), ownerId)
                .set(fUuid("team_id"), teamId)
                .set(fTime("updated_at"), now)
                .where(fUuid("id").eq(id).and(fTime("archived_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    void archive(UUID id, OffsetDateTime now) {
        int changed = dsl.update(KNOWLEDGE_BASES)
                .set(fTime("archived_at"), now)
                .set(fTime("updated_at"), now)
                .where(fUuid("id").eq(id).and(fTime("archived_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    boolean pageBelongs(UUID knowledgeBaseId, UUID pageId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("pages")))
                .where(fUuid("id")
                        .eq(pageId)
                        .and(fUuid("knowledge_base_id").eq(knowledgeBaseId))
                        .and(fTime("deleted_at").isNull())));
    }

    boolean workspaceMember(UUID workspaceId, UUID userId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("workspace_memberships")))
                .where(fUuid("workspace_id")
                        .eq(workspaceId)
                        .and(fUuid("user_id").eq(userId))));
    }

    void upsertMember(
            UUID knowledgeBaseId,
            UUID userId,
            String role,
            OffsetDateTime now) {
        dsl.insertInto(MEMBERS)
                .columns(
                        fUuid("knowledge_base_id"),
                        fUuid("user_id"),
                        fString("role"),
                        fTime("created_at"),
                        fTime("updated_at"))
                .values(knowledgeBaseId, userId, role, now, now)
                .onConflict(fUuid("knowledge_base_id"), fUuid("user_id"))
                .doUpdate()
                .set(fString("role"), role)
                .set(fTime("updated_at"), now)
                .execute();
    }

    void removeMember(UUID knowledgeBaseId, UUID userId) {
        int changed = dsl.deleteFrom(MEMBERS)
                .where(fUuid("knowledge_base_id")
                        .eq(knowledgeBaseId)
                        .and(fUuid("user_id").eq(userId)))
                .execute();
        requireChanged(changed);
    }

    List<KnowledgeBaseMemberView> members(UUID knowledgeBaseId) {
        return dsl.select(
                        field(name("km", "user_id"), UUID.class),
                        field(name("u", "email_normalized"), String.class),
                        field(name("u", "display_name"), String.class),
                        field(name("km", "role"), String.class),
                        field(name("km", "created_at"), OffsetDateTime.class),
                        field(name("km", "updated_at"), OffsetDateTime.class))
                .from(table(name("knowledge_base_members")).as("km"))
                .join(table(name("users")).as("u"))
                .on(field(name("u", "id"), UUID.class)
                        .eq(field(name("km", "user_id"), UUID.class)))
                .where(field(name("km", "knowledge_base_id"), UUID.class)
                        .eq(knowledgeBaseId))
                .orderBy(field(name("km", "role")).asc(), field(name("u", "email_normalized")).asc())
                .fetch(record -> new KnowledgeBaseMemberView(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        record.value5(),
                        record.value6()));
    }

    private org.jooq.SelectConditionStep<? extends Record> selectActive() {
        return dsl.select(
                        fUuid("id"),
                        fUuid("workspace_id"),
                        fString("name"),
                        fString("slug"),
                        fString("description"),
                        fString("icon"),
                        fString("owner_type"),
                        fUuid("owner_id"),
                        fUuid("team_id"),
                        fUuid("homepage_page_id"),
                        fString("visibility"),
                        field(name("allow_public_index"), Boolean.class),
                        fString("publish_mode"),
                        field(name("watermark_config"), JSONB.class),
                        field(name("appearance_config"), JSONB.class),
                        field(name("catalog_config"), JSONB.class),
                        field(name("catalog_revision"), Long.class),
                        fUuid("created_by"),
                        fTime("created_at"),
                        fTime("updated_at"))
                .from(KNOWLEDGE_BASES)
                .where(fTime("archived_at").isNull());
    }

    private static KnowledgeBaseView map(Record record) {
        return new KnowledgeBaseView(
                record.get(fUuid("id")),
                record.get(fUuid("workspace_id")),
                record.get(fString("name")),
                record.get(fString("slug")),
                record.get(fString("description")),
                record.get(fString("icon")),
                record.get(fString("owner_type")),
                record.get(fUuid("owner_id")),
                record.get(fUuid("team_id")),
                record.get(fUuid("homepage_page_id")),
                record.get(fString("visibility")),
                Boolean.TRUE.equals(record.get(field(name("allow_public_index"), Boolean.class))),
                record.get(fString("publish_mode")),
                record.get(field(name("watermark_config"), JSONB.class)).data(),
                record.get(field(name("appearance_config"), JSONB.class)).data(),
                record.get(field(name("catalog_config"), JSONB.class)).data(),
                record.get(field(name("catalog_revision"), Long.class)),
                record.get(fUuid("created_by")),
                record.get(fTime("created_at")),
                record.get(fTime("updated_at")));
    }

    private static org.jooq.Field<UUID> fUuid(String value) {
        return field(name(value), UUID.class);
    }

    private static org.jooq.Field<String> fString(String value) {
        return field(name(value), String.class);
    }

    private static org.jooq.Field<OffsetDateTime> fTime(String value) {
        return field(name(value), OffsetDateTime.class);
    }

    private static void requireChanged(int changed) {
        if (changed != 1) {
            throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
    }
}
