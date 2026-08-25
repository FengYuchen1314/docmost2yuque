package io.knowledge.platform.publication;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import io.knowledge.platform.common.Ids;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Repository
class PublicationRepository {

    private static final Table<Record> PUBLICATIONS = table(name("page_publications"));
    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    PublicationRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    DraftSnapshot draftForUpdate(UUID pageId) {
        return dsl.select(
                        field(name("p", "id"), UUID.class),
                        field(name("p", "workspace_id"), UUID.class),
                        field(name("p", "knowledge_base_id"), UUID.class),
                        field(name("p", "title"), String.class),
                        field(name("p", "path"), String.class),
                        field(name("p", "icon"), String.class),
                        field(name("p", "cover"), String.class),
                        field(
                                "case when {0} = 'INHERIT' then {1} else {0} end",
                                String.class,
                                field(name("p", "visibility_override"), String.class),
                                field(name("kb", "visibility"), String.class)),
                        field(name("p", "created_at"), OffsetDateTime.class),
                        field(name("p", "content_type"), String.class),
                        field(name("p", "schema_version"), Integer.class),
                        field(name("p", "draft_revision"), Long.class),
                        field(name("p", "document_settings"), JSONB.class),
                        field(name("d", "content_json"), JSONB.class),
                        field(name("d", "plain_text"), String.class))
                .from(table(name("pages")).as("p"))
                .join(table(name("page_drafts")).as("d"))
                .on(field(name("d", "page_id"), UUID.class)
                        .eq(field(name("p", "id"), UUID.class)))
                .join(table(name("knowledge_bases")).as("kb"))
                .on(field(name("kb", "id"), UUID.class)
                        .eq(field(name("p", "knowledge_base_id"), UUID.class)))
                .where(field(name("p", "id"), UUID.class)
                        .eq(pageId)
                        .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNull()))
                .forUpdate()
                .fetchOne(record -> new DraftSnapshot(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        record.value5(),
                        record.value6(),
                        record.value7(),
                        record.value8(),
                        record.value9(),
                        record.value10(),
                        record.value11(),
                        record.value12(),
                        objectMapper.readTree(record.value13().data()),
                        objectMapper.readTree(record.value14().data()),
                        record.value15()));
    }

    PagePublicationView findRequest(UUID pageId, UUID actorId, String key) {
        UUID publicationId = dsl.select(field(name("publication_id"), UUID.class))
                .from(table(name("publication_requests")))
                .where(field(name("page_id"), UUID.class)
                        .eq(pageId)
                        .and(field(name("actor_id"), UUID.class).eq(actorId))
                        .and(field(name("idempotency_key"), String.class).eq(key)))
                .fetchOne(field(name("publication_id"), UUID.class));
        return publicationId == null ? null : find(publicationId);
    }

    PagePublicationView insert(
            DraftSnapshot draft,
            UUID actorId,
            String idempotencyKey,
            List<String> labels,
            OffsetDateTime now) {
        dsl.update(PUBLICATIONS)
                .set(field(name("superseded_at"), OffsetDateTime.class), now)
                .where(field(name("page_id"), UUID.class)
                        .eq(draft.pageId())
                        .and(field(name("superseded_at"), OffsetDateTime.class).isNull()))
                .execute();
        UUID publicationId = Ids.next();
        var metadata = objectMapper.createObjectNode();
        metadata.set("documentSettings", draft.documentSettings());
        metadata.put("icon", draft.icon());
        metadata.put("cover", draft.cover());
        var labelValues = metadata.putArray("labels");
        labels.forEach(labelValues::add);
        dsl.insertInto(PUBLICATIONS)
                .columns(
                        uuid("id"),
                        uuid("workspace_id"),
                        uuid("knowledge_base_id"),
                        uuid("page_id"),
                        number("source_draft_revision"),
                        string("content_type"),
                        string("title_snapshot"),
                        json("content_snapshot"),
                        string("plain_text_snapshot"),
                        json("metadata_snapshot"),
                        integer("schema_version"),
                        uuid("published_by"),
                        time("published_at"))
                .values(
                        publicationId,
                        draft.workspaceId(),
                        draft.knowledgeBaseId(),
                        draft.pageId(),
                        draft.draftRevision(),
                        draft.contentType(),
                        draft.title(),
                        JSONB.valueOf(objectMapper.writeValueAsString(draft.content())),
                        draft.plainText(),
                        JSONB.valueOf(objectMapper.writeValueAsString(metadata)),
                        draft.schemaVersion(),
                        actorId,
                        now)
                .execute();
        dsl.execute("""
                insert into publication_attachments(publication_id, attachment_id)
                select ?::uuid, attachment.id
                from page_card_instances card
                cross join lateral jsonb_array_elements(
                    case when card.card_id = 'gallery' and jsonb_typeof(card.data_json -> 'items') = 'array'
                         then card.data_json -> 'items'
                         else jsonb_build_array(card.data_json) end
                ) reference(data)
                join attachments attachment
                  on attachment.id = case
                       when (reference.data ->> 'attachmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                       then (reference.data ->> 'attachmentId')::uuid end
                 and attachment.page_id = card.page_id
                 and attachment.deleted_at is null
                where card.page_id = ?::uuid
                  and card.page_revision_no = ?
                  and card.archived_at is null
                  and reference.data ->> 'attachmentId' is not null
                  and (reference.data ->> 'attachmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                on conflict do nothing
                """, publicationId, draft.pageId(), draft.draftRevision());
        dsl.update(table(name("pages")))
                .set(uuid("published_revision_id"), publicationId)
                .set(time("published_at"), now)
                .where(uuid("id").eq(draft.pageId()))
                .execute();
        dsl.insertInto(table(name("publication_requests")))
                .columns(
                        uuid("page_id"),
                        uuid("actor_id"),
                        string("idempotency_key"),
                        uuid("publication_id"),
                        time("created_at"))
                .values(draft.pageId(), actorId, idempotencyKey, publicationId, now)
                .execute();
        insertOutbox(draft, publicationId, "PagePublished", now);
        return find(publicationId);
    }

    void unpublish(DraftSnapshot draft, OffsetDateTime now) {
        dsl.update(PUBLICATIONS)
                .set(time("superseded_at"), now)
                .where(uuid("page_id")
                        .eq(draft.pageId())
                        .and(time("superseded_at").isNull()))
                .execute();
        dsl.update(table(name("pages")))
                .set(uuid("published_revision_id"), (UUID) null)
                .set(time("published_at"), (OffsetDateTime) null)
                .where(uuid("id").eq(draft.pageId()))
                .execute();
        insertOutbox(draft, null, "PageUnpublished", now);
    }

    void archiveWorkspace(UUID workspaceId, OffsetDateTime now) {
        dsl.update(PUBLICATIONS)
                .set(time("superseded_at"), now)
                .where(uuid("workspace_id").eq(workspaceId)
                        .and(time("superseded_at").isNull()))
                .execute();
        dsl.update(table(name("pages")))
                .set(uuid("published_revision_id"), (UUID) null)
                .set(time("published_at"), (OffsetDateTime) null)
                .where(uuid("workspace_id").eq(workspaceId))
                .execute();
    }

    PagePublicationView currentForPage(UUID pageId) {
        return selectPublications()
                .and(uuid("page_id")
                        .eq(pageId)
                        .and(time("superseded_at").isNull()))
                .fetchOne(this::map);
    }

    boolean autoPublishEnabled(UUID pageId) {
        String mode = dsl.select(field(
                        "case when {0} = 'INHERIT' then {1} else {0} end",
                        String.class,
                        field(name("p", "publish_mode"), String.class),
                        field(name("kb", "publish_mode"), String.class)))
                .from(table(name("pages")).as("p"))
                .join(table(name("knowledge_bases")).as("kb"))
                .on(field(name("kb", "id"), UUID.class)
                        .eq(field(name("p", "knowledge_base_id"), UUID.class)))
                .where(field(name("p", "id"), UUID.class)
                        .eq(pageId)
                        .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNull()))
                .fetchOne(0, String.class);
        return "AUTO".equals(mode);
    }

    PagePublicationView find(UUID publicationId) {
        return selectPublications()
                .and(uuid("id").eq(publicationId))
                .fetchOne(this::map);
    }

    List<PagePublicationView> history(UUID pageId, int limit, int offset) {
        return selectPublications()
                .and(uuid("page_id").eq(pageId))
                .orderBy(time("published_at").desc(), uuid("id").desc())
                .limit(Math.max(1, Math.min(limit, 100)))
                .offset(Math.max(0, offset))
                .fetch(this::map);
    }

    PublicationState state(UUID pageId) {
        Record record = dsl.select(
                        field(name("p", "draft_revision"), Long.class),
                        field(name("p", "published_revision_id"), UUID.class),
                        field(name("pp", "source_draft_revision"), Long.class),
                        field(
                                "case when {0} = 'INHERIT' then {1} else {0} end",
                                String.class,
                                field(name("p", "publish_mode"), String.class),
                                field(name("kb", "publish_mode"), String.class)))
                .from(table(name("pages")).as("p"))
                .join(table(name("knowledge_bases")).as("kb"))
                .on(field(name("kb", "id"), UUID.class)
                        .eq(field(name("p", "knowledge_base_id"), UUID.class)))
                .leftJoin(table(name("page_publications")).as("pp"))
                .on(field(name("pp", "id"), UUID.class)
                        .eq(field(name("p", "published_revision_id"), UUID.class)))
                .where(field(name("p", "id"), UUID.class)
                        .eq(pageId)
                        .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNull()))
                .fetchOne();
        if (record == null) {
            return null;
        }
        long draftRevision =
                record.get(field(name("p", "draft_revision"), Long.class));
        UUID publicationId =
                record.get(field(name("p", "published_revision_id"), UUID.class));
        Long publishedRevision =
                record.get(field(name("pp", "source_draft_revision"), Long.class));
        String effectiveMode = record.get(3, String.class);
        String jobStatus = dsl.select(string("status"))
                .from(table(name("durable_jobs")))
                .where(string("idempotency_key").eq(
                        "page-auto-publish:" + pageId + ":" + draftRevision))
                .fetchOne(string("status"));
        return new PublicationState(
                pageId,
                draftRevision,
                publicationId,
                publishedRevision,
                publicationId != null,
                publishedRevision != null && publishedRevision == draftRevision,
                effectiveMode,
                jobStatus);
    }

    private void insertOutbox(
            DraftSnapshot draft,
            UUID publicationId,
            String eventType,
            OffsetDateTime now) {
        JsonNode payload = objectMapper.createObjectNode()
                .put("workspaceId", draft.workspaceId().toString())
                .put("knowledgeBaseId", draft.knowledgeBaseId().toString())
                .put("pageId", draft.pageId().toString())
                .put("publicationId", publicationId == null ? null : publicationId.toString())
                .put("draftRevision", draft.draftRevision());
        dsl.insertInto(table(name("outbox_events")))
                .columns(
                        uuid("id"),
                        string("aggregate_type"),
                        uuid("aggregate_id"),
                        string("event_type"),
                        json("payload"),
                        time("occurred_at"))
                .values(
                        Ids.next(),
                        "PAGE",
                        draft.pageId(),
                        eventType,
                        JSONB.valueOf(objectMapper.writeValueAsString(payload)),
                        now)
                .execute();
    }

    private org.jooq.SelectConditionStep<? extends Record> selectPublications() {
        return dsl.select(
                        uuid("id"),
                        uuid("workspace_id"),
                        uuid("knowledge_base_id"),
                        uuid("page_id"),
                        number("source_draft_revision"),
                        string("content_type"),
                        string("title_snapshot"),
                        json("content_snapshot"),
                        string("plain_text_snapshot"),
                        json("metadata_snapshot"),
                        integer("schema_version"),
                        uuid("published_by"),
                        time("published_at"),
                        time("superseded_at"))
                .from(PUBLICATIONS)
                .where(uuid("id").isNotNull());
    }

    private PagePublicationView map(Record record) {
        JSONB content = record.get(json("content_snapshot"));
        return new PagePublicationView(
                record.get(uuid("id")),
                record.get(uuid("workspace_id")),
                record.get(uuid("knowledge_base_id")),
                record.get(uuid("page_id")),
                record.get(number("source_draft_revision")),
                record.get(string("content_type")),
                record.get(string("title_snapshot")),
                content == null ? null : objectMapper.readTree(content.data()),
                record.get(string("plain_text_snapshot")),
                objectMapper.readTree(record.get(json("metadata_snapshot")).data()),
                record.get(integer("schema_version")),
                record.get(uuid("published_by")),
                record.get(time("published_at")),
                record.get(time("superseded_at")));
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

    private static org.jooq.Field<Long> number(String value) {
        return field(name(value), Long.class);
    }

    private static org.jooq.Field<Integer> integer(String value) {
        return field(name(value), Integer.class);
    }

    private static org.jooq.Field<JSONB> json(String value) {
        return field(name(value), JSONB.class);
    }

    record DraftSnapshot(
            UUID pageId,
            UUID workspaceId,
            UUID knowledgeBaseId,
            String title,
            String path,
            String icon,
            String cover,
            String effectiveVisibility,
            OffsetDateTime createdAt,
            String contentType,
            int schemaVersion,
            long draftRevision,
            JsonNode documentSettings,
            JsonNode content,
            String plainText) {}
}
