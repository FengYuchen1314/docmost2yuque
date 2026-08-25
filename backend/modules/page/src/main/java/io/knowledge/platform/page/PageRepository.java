package io.knowledge.platform.page;

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
import tools.jackson.databind.ObjectMapper;

@Repository
class PageRepository {

    private static final Table<Record> PAGES = table(name("pages"));
    private static final Table<Record> DRAFTS = table(name("page_drafts"));
    private static final Table<Record> HISTORIES = table(name("page_histories"));
    private static final Table<Record> LABELS = table(name("page_labels"));
    private static final Table<Record> MATERIALIZATIONS =
            table(name("page_collaboration_materializations"));
    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    PageRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    void insert(PageView page) {
        dsl.insertInto(PAGES)
                .columns(
                        uuid("id"),
                        uuid("workspace_id"),
                        uuid("knowledge_base_id"),
                        string("title"),
                        string("icon"),
                        string("cover"),
                        string("content_type"),
                        string("path"),
                        string("publish_mode"),
                        string("visibility_override"),
                        json("document_settings"),
                        integer("schema_version"),
                        number("draft_revision"),
                        uuid("created_by"),
                        uuid("updated_by"),
                        time("created_at"),
                        time("updated_at"))
                .values(
                        page.id(),
                        page.workspaceId(),
                        page.knowledgeBaseId(),
                        page.title(),
                        page.icon(),
                        page.cover(),
                        page.contentType().name(),
                        page.path(),
                        page.publishMode(),
                        page.visibilityOverride(),
                        JSONB.valueOf(objectMapper.writeValueAsString(page.documentSettings())),
                        page.schemaVersion(),
                        page.draftRevision(),
                        page.createdBy(),
                        page.updatedBy(),
                        page.createdAt(),
                        page.updatedAt())
                .execute();
        dsl.insertInto(DRAFTS)
                .columns(
                        uuid("page_id"),
                        json("content_json"),
                        string("plain_text"),
                        number("revision_no"),
                        integer("schema_version"),
                        uuid("updated_by"),
                        time("updated_at"))
                .values(
                        page.id(),
                        JSONB.valueOf(objectMapper.writeValueAsString(page.content())),
                        page.plainText(),
                        page.draftRevision(),
                        page.schemaVersion(),
                        page.updatedBy(),
                        page.updatedAt())
                .execute();
    }

    PageView findActive(UUID pageId) {
        return selectJoined()
                .and(field(name("p", "id"), UUID.class)
                        .eq(pageId)
                        .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNull()))
                .fetchOne(this::map);
    }

    PageView findActiveForUpdate(UUID pageId) {
        UUID locked = dsl.select(uuid("id"))
                .from(PAGES)
                .where(uuid("id")
                        .eq(pageId)
                        .and(time("deleted_at").isNull()))
                .forUpdate()
                .fetchOne(uuid("id"));
        return locked == null ? null : findActive(locked);
    }

    PageView findAny(UUID pageId) {
        return selectJoined()
                .and(field(name("p", "id"), UUID.class).eq(pageId))
                .fetchOne(this::map);
    }

    List<PageView> listActive(UUID knowledgeBaseId) {
        return selectJoined()
                .and(field(name("p", "knowledge_base_id"), UUID.class)
                        .eq(knowledgeBaseId)
                        .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNull()))
                .orderBy(field(name("p", "updated_at")).desc())
                .fetch(this::map);
    }

    List<PageView> listTrash(UUID workspaceId) {
        return selectJoined()
                .and(field(name("p", "workspace_id"), UUID.class)
                        .eq(workspaceId)
                        .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNotNull()))
                .orderBy(field(name("p", "deleted_at")).desc())
                .fetch(this::map);
    }

    List<TrashItemView> globalTrash(
            UUID actorId, String query, int offset, int limit) {
        return dsl.fetch("""
                select p.id,p.workspace_id,w.name workspace_name,
                       p.knowledge_base_id,kb.name knowledge_base_name,kb.icon knowledge_base_icon,
                       p.title,p.content_type,p.path,p.updated_by deleted_by,
                       coalesce(u.display_name,u.email_original) deleted_by_name,
                       u.email_original deleted_by_email,p.deleted_at
                  from pages p
                  join workspaces w on w.id=p.workspace_id and w.deleted_at is null
                  join workspace_memberships wm on wm.workspace_id=p.workspace_id and wm.user_id=?::uuid
                  join knowledge_bases kb on kb.id=p.knowledge_base_id
                  join users u on u.id=p.updated_by
                 cross join (select ?::text term) trash_filter
                 where p.deleted_at is not null
                   and (trash_filter.term='' or p.title ilike ('%'||trash_filter.term||'%')
                        or kb.name ilike ('%'||trash_filter.term||'%')
                        or w.name ilike ('%'||trash_filter.term||'%'))
                 order by p.deleted_at desc,p.id desc
                 offset ? limit ?
                """, actorId, query, offset, limit)
                .map(record -> new TrashItemView(
                        record.get("id", UUID.class),
                        record.get("workspace_id", UUID.class),
                        record.get("workspace_name", String.class),
                        record.get("knowledge_base_id", UUID.class),
                        record.get("knowledge_base_name", String.class),
                        record.get("knowledge_base_icon", String.class),
                        record.get("title", String.class),
                        ContentType.valueOf(record.get("content_type", String.class)),
                        record.get("path", String.class),
                        record.get("deleted_by", UUID.class),
                        record.get("deleted_by_name", String.class),
                        record.get("deleted_by_email", String.class),
                        record.get("deleted_at", OffsetDateTime.class),
                        false,
                        false));
    }

    boolean update(
            PageView page,
            long expectedRevision,
            String revisionKind,
            String revisionDescription) {
        long nextRevision = expectedRevision + 1;
        int changed = dsl.update(PAGES)
                .set(string("title"), page.title())
                .set(string("path"), page.path())
                .set(string("icon"), page.icon())
                .set(string("cover"), page.cover())
                .set(string("publish_mode"), page.publishMode())
                .set(string("visibility_override"), page.visibilityOverride())
                .set(json("document_settings"),
                        JSONB.valueOf(objectMapper.writeValueAsString(page.documentSettings())))
                .set(integer("schema_version"), page.schemaVersion())
                .set(number("draft_revision"), nextRevision)
                .set(uuid("updated_by"), page.updatedBy())
                .set(time("updated_at"), page.updatedAt())
                .where(uuid("id")
                        .eq(page.id())
                        .and(number("draft_revision").eq(expectedRevision))
                        .and(time("deleted_at").isNull()))
                .execute();
        if (changed == 0) {
            return false;
        }
        dsl.update(DRAFTS)
                .set(json("content_json"),
                        JSONB.valueOf(objectMapper.writeValueAsString(page.content())))
                .set(string("plain_text"), page.plainText())
                .set(number("revision_no"), nextRevision)
                .set(integer("schema_version"), page.schemaVersion())
                .set(uuid("updated_by"), page.updatedBy())
                .set(time("updated_at"), page.updatedAt())
                .where(uuid("page_id").eq(page.id()))
                .execute();
        insertHistory(page, nextRevision, revisionKind, revisionDescription);
        return true;
    }

    CollaborationMaterializationView materializeCollaboration(
            UUID pageId,
            long sequence,
            UUID actorId,
            tools.jackson.databind.JsonNode content,
            String plainText,
            OffsetDateTime now) {
        Long lockedRevision = dsl.select(number("draft_revision"))
                .from(PAGES)
                .where(uuid("id").eq(pageId).and(time("deleted_at").isNull()))
                .forUpdate()
                .fetchOne(number("draft_revision"));
        if (lockedRevision == null) {
            throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
        Long priorSequence = dsl.select(number("sequence"))
                .from(MATERIALIZATIONS)
                .where(uuid("page_id").eq(pageId))
                .fetchOne(number("sequence"));
        if (priorSequence != null && sequence <= priorSequence) {
            return new CollaborationMaterializationView(false, sequence, lockedRevision);
        }

        PageView current = findActive(pageId);
        if (current == null) {
            throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
        PageView projected = new PageView(
                current.id(),
                current.workspaceId(),
                current.knowledgeBaseId(),
                current.title(),
                current.icon(),
                current.cover(),
                current.contentType(),
                current.path(),
                current.publishMode(),
                current.publishedRevisionId(),
                current.publishedAt(),
                current.visibilityOverride(),
                current.documentSettings(),
                current.schemaVersion(),
                lockedRevision + 1,
                content,
                plainText,
                current.createdBy(),
                actorId,
                current.createdAt(),
                now,
                null);
        if (!update(
                projected,
                lockedRevision,
                "AUTO",
                "Realtime collaboration synchronization")) {
            throw new IllegalStateException("Locked page revision changed unexpectedly");
        }
        dsl.insertInto(MATERIALIZATIONS)
                .columns(uuid("page_id"), number("sequence"), time("materialized_at"))
                .values(pageId, sequence, now)
                .onConflict(uuid("page_id"))
                .doUpdate()
                .set(number("sequence"), sequence)
                .set(time("materialized_at"), now)
                .execute();
        return new CollaborationMaterializationView(true, sequence, lockedRevision + 1);
    }

    void softDelete(UUID pageId, OffsetDateTime now, UUID actorId) {
        int changed = dsl.update(PAGES)
                .set(time("deleted_at"), now)
                .set(uuid("updated_by"), actorId)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(pageId).and(time("deleted_at").isNull()))
                .execute();
        requireChanged(changed);
        dsl.update(table(name("knowledge_bases")))
                .set(uuid("homepage_page_id"), (UUID) null)
                .set(time("updated_at"), now)
                .where(uuid("homepage_page_id").eq(pageId))
                .execute();
    }

    void restore(UUID pageId, OffsetDateTime now, UUID actorId) {
        int changed = dsl.update(PAGES)
                .set(time("deleted_at"), (OffsetDateTime) null)
                .set(uuid("updated_by"), actorId)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(pageId).and(time("deleted_at").isNotNull()))
                .execute();
        requireChanged(changed);
    }

    void permanentlyDelete(UUID pageId) {
        int changed = dsl.deleteFrom(PAGES).where(uuid("id").eq(pageId)).execute();
        requireChanged(changed);
    }

    List<PageHistoryView> history(UUID pageId, int limit, int offset) {
        return dsl.select(
                        uuid("id"),
                        uuid("page_id"),
                        number("revision_no"),
                        string("revision_kind"),
                        string("description"),
                        string("title_snapshot"),
                        json("content_json_snapshot"),
                        string("plain_text_snapshot"),
                        integer("schema_version"),
                        uuid("created_by"),
                        time("created_at"))
                .from(HISTORIES)
                .where(uuid("page_id").eq(pageId))
                .orderBy(number("revision_no").desc())
                .limit(Math.max(1, Math.min(limit, 200)))
                .offset(Math.max(0, offset))
                .fetch(record -> new PageHistoryView(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        record.value5(),
                        record.value6(),
                        objectMapper.readTree(record.value7().data()),
                        record.value8(),
                        record.value9(),
                        record.value10(),
                        record.value11()));
    }

    PageHistoryView historyRevision(UUID pageId, long revisionNo) {
        return dsl.select(
                        uuid("id"),
                        uuid("page_id"),
                        number("revision_no"),
                        string("revision_kind"),
                        string("description"),
                        string("title_snapshot"),
                        json("content_json_snapshot"),
                        string("plain_text_snapshot"),
                        integer("schema_version"),
                        uuid("created_by"),
                        time("created_at"))
                .from(HISTORIES)
                .where(uuid("page_id").eq(pageId)
                        .and(number("revision_no").eq(revisionNo)))
                .fetchOne(record -> new PageHistoryView(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        record.value5(),
                        record.value6(),
                        objectMapper.readTree(record.value7().data()),
                        record.value8(),
                        record.value9(),
                        record.value10(),
                        record.value11()));
    }

    long labelRevision(UUID pageId) {
        Long value = dsl.select(number("label_revision"))
                .from(PAGES)
                .where(uuid("id").eq(pageId).and(time("deleted_at").isNull()))
                .fetchOne(number("label_revision"));
        if (value == null) {
            throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
        return value;
    }

    List<PageLabelView> labels(UUID pageId) {
        return dsl.select(
                        uuid("id"),
                        string("name"),
                        string("color"),
                        integer("position"),
                        uuid("created_by"),
                        time("created_at"))
                .from(LABELS)
                .where(uuid("page_id").eq(pageId))
                .orderBy(integer("position"))
                .fetch(record -> new PageLabelView(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        record.value5(),
                        record.value6()));
    }

    boolean replaceLabels(
            UUID pageId,
            UUID workspaceId,
            long expectedRevision,
            List<NormalizedPageLabel> labels,
            UUID actorId,
            OffsetDateTime now) {
        int changed = dsl.update(PAGES)
                .set(number("label_revision"), expectedRevision + 1)
                .set(uuid("updated_by"), actorId)
                .set(time("updated_at"), now)
                .where(uuid("id")
                        .eq(pageId)
                        .and(number("label_revision").eq(expectedRevision))
                        .and(time("deleted_at").isNull()))
                .execute();
        if (changed == 0) return false;
        dsl.deleteFrom(LABELS).where(uuid("page_id").eq(pageId)).execute();
        for (int position = 0; position < labels.size(); position++) {
            NormalizedPageLabel label = labels.get(position);
            dsl.insertInto(LABELS)
                    .columns(
                            uuid("id"),
                            uuid("workspace_id"),
                            uuid("page_id"),
                            string("name"),
                            string("normalized_name"),
                            string("color"),
                            integer("position"),
                            uuid("created_by"),
                            time("created_at"))
                    .values(
                            io.knowledge.platform.common.Ids.next(),
                            workspaceId,
                            pageId,
                            label.name(),
                            label.normalizedName(),
                            label.color(),
                            position,
                            actorId,
                            now)
                    .execute();
        }
        return true;
    }

    private void insertHistory(
            PageView page,
            long revision,
            String revisionKind,
            String revisionDescription) {
        dsl.insertInto(HISTORIES)
                .columns(
                        uuid("id"),
                        uuid("workspace_id"),
                        uuid("knowledge_base_id"),
                        uuid("page_id"),
                        number("revision_no"),
                        string("revision_kind"),
                        string("description"),
                        string("title_snapshot"),
                        json("content_json_snapshot"),
                        string("plain_text_snapshot"),
                        integer("schema_version"),
                        uuid("created_by"),
                        time("created_at"))
                .values(
                        io.knowledge.platform.common.Ids.next(),
                        page.workspaceId(),
                        page.knowledgeBaseId(),
                        page.id(),
                        revision,
                        revisionKind,
                        revisionDescription,
                        page.title(),
                        JSONB.valueOf(objectMapper.writeValueAsString(page.content())),
                        page.plainText(),
                        page.schemaVersion(),
                        page.updatedBy(),
                        page.updatedAt())
                .execute();
    }

    private org.jooq.SelectConditionStep<? extends Record> selectJoined() {
        return dsl.select(
                        field(name("p", "id"), UUID.class),
                        field(name("p", "workspace_id"), UUID.class),
                        field(name("p", "knowledge_base_id"), UUID.class),
                        field(name("p", "title"), String.class),
                        field(name("p", "icon"), String.class),
                        field(name("p", "cover"), String.class),
                        field(name("p", "content_type"), String.class),
                        field(name("p", "path"), String.class),
                        field(name("p", "publish_mode"), String.class),
                        field(name("p", "published_revision_id"), UUID.class),
                        field(name("p", "published_at"), OffsetDateTime.class),
                        field(name("p", "visibility_override"), String.class),
                        field(name("p", "document_settings"), JSONB.class),
                        field(name("p", "schema_version"), Integer.class),
                        field(name("p", "draft_revision"), Long.class),
                        field(name("d", "content_json"), JSONB.class),
                        field(name("d", "plain_text"), String.class),
                        field(name("p", "created_by"), UUID.class),
                        field(name("p", "updated_by"), UUID.class),
                        field(name("p", "created_at"), OffsetDateTime.class),
                        field(name("p", "updated_at"), OffsetDateTime.class),
                        field(name("p", "deleted_at"), OffsetDateTime.class))
                .from(table(name("pages")).as("p"))
                .join(table(name("page_drafts")).as("d"))
                .on(field(name("d", "page_id"), UUID.class)
                        .eq(field(name("p", "id"), UUID.class)))
                .where(field(name("p", "id"), UUID.class).isNotNull());
    }

    private PageView map(Record record) {
        return new PageView(
                record.get(field(name("p", "id"), UUID.class)),
                record.get(field(name("p", "workspace_id"), UUID.class)),
                record.get(field(name("p", "knowledge_base_id"), UUID.class)),
                record.get(field(name("p", "title"), String.class)),
                record.get(field(name("p", "icon"), String.class)),
                record.get(field(name("p", "cover"), String.class)),
                ContentType.valueOf(record.get(field(name("p", "content_type"), String.class))),
                record.get(field(name("p", "path"), String.class)),
                record.get(field(name("p", "publish_mode"), String.class)),
                record.get(field(name("p", "published_revision_id"), UUID.class)),
                record.get(field(name("p", "published_at"), OffsetDateTime.class)),
                record.get(field(name("p", "visibility_override"), String.class)),
                objectMapper.readTree(record.get(field(name("p", "document_settings"), JSONB.class)).data()),
                record.get(field(name("p", "schema_version"), Integer.class)),
                record.get(field(name("p", "draft_revision"), Long.class)),
                objectMapper.readTree(record.get(field(name("d", "content_json"), JSONB.class)).data()),
                record.get(field(name("d", "plain_text"), String.class)),
                record.get(field(name("p", "created_by"), UUID.class)),
                record.get(field(name("p", "updated_by"), UUID.class)),
                record.get(field(name("p", "created_at"), OffsetDateTime.class)),
                record.get(field(name("p", "updated_at"), OffsetDateTime.class)),
                record.get(field(name("p", "deleted_at"), OffsetDateTime.class)));
    }

    private static org.jooq.Field<UUID> uuid(String value) {
        return field(name(value), UUID.class);
    }

    private static org.jooq.Field<String> string(String value) {
        return field(name(value), String.class);
    }

    private static org.jooq.Field<OffsetDateTime> time(String value) {
        return field(name(value), OffsetDateTime.class);
    }

    private static org.jooq.Field<Integer> integer(String value) {
        return field(name(value), Integer.class);
    }

    private static org.jooq.Field<Long> number(String value) {
        return field(name(value), Long.class);
    }

    private static org.jooq.Field<JSONB> json(String value) {
        return field(name(value), JSONB.class);
    }

    private static void requireChanged(int changed) {
        if (changed != 1) {
            throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
    }
}
