package io.knowledge.platform.page;

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
class PageReferenceRepository {

    private static final Table<Record> REFERENCES = table(name("page_references"));
    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    PageReferenceRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    void replaceDraft(
            PageView source,
            List<ExtractedPageReference> references,
            OffsetDateTime now) {
        dsl.deleteFrom(REFERENCES)
                .where(uuid("source_page_id")
                        .eq(source.id())
                        .and(string("source_scope").eq("DRAFT")))
                .execute();
        for (ExtractedPageReference reference : references) {
            insert(
                    source.workspaceId(),
                    source.id(),
                    "DRAFT",
                    source.draftRevision(),
                    null,
                    reference.targetPageId(),
                    reference.targetBlockId(),
                    reference.kind(),
                    reference.mode(),
                    reference.fixedPublicationId(),
                    reference.sourcePointer(),
                    reference.displaySettings(),
                    reference.ordinal(),
                    now);
        }
    }

    void snapshotPublication(
            UUID sourcePageId,
            UUID publicationId,
            long sourceRevision,
            OffsetDateTime now) {
        dsl.deleteFrom(REFERENCES)
                .where(uuid("source_publication_id").eq(publicationId))
                .execute();
        for (StoredPageReference reference : outgoing(sourcePageId)) {
            insert(
                    reference.workspaceId(),
                    sourcePageId,
                    "PUBLISHED",
                    sourceRevision,
                    publicationId,
                    reference.targetPageId(),
                    reference.targetBlockId(),
                    reference.kind(),
                    reference.mode(),
                    reference.fixedPublicationId(),
                    reference.sourcePointer(),
                    reference.displaySettings(),
                    reference.ordinal(),
                    now);
        }
    }

    List<StoredPageReference> outgoing(UUID sourcePageId) {
        return selectReferences()
                .where(uuid("source_page_id")
                        .eq(sourcePageId)
                        .and(string("source_scope").eq("DRAFT")))
                .orderBy(integer("ordinal_no").asc())
                .fetch(this::mapReference);
    }

    List<StoredPageReference> backlinks(UUID targetPageId) {
        return selectReferences()
                .where(uuid("target_page_id")
                        .eq(targetPageId))
                .orderBy(time("created_at").desc())
                .fetch(this::mapReference);
    }

    StoredPageReference find(UUID referenceId) {
        return selectReferences()
                .where(uuid("id").eq(referenceId))
                .fetchOne(this::mapReference);
    }

    PageMetadata metadata(UUID pageId) {
        return dsl.select(
                        field(name("id"), UUID.class),
                        field(name("workspace_id"), UUID.class),
                        field(name("knowledge_base_id"), UUID.class),
                        field(name("title"), String.class),
                        field(name("content_type"), String.class),
                        field(name("path"), String.class),
                        field(name("published_revision_id"), UUID.class),
                        field(name("updated_at"), OffsetDateTime.class))
                .from(table(name("pages")))
                .where(field(name("id"), UUID.class)
                        .eq(pageId)
                        .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                .fetchOne(record -> new PageMetadata(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        ContentType.valueOf(record.value5()),
                        record.value6(),
                        record.value7(),
                        record.value8()));
    }

    ContentSnapshot draftSnapshot(UUID pageId) {
        return dsl.select(
                        field(name("p", "id"), UUID.class),
                        field(name("p", "title"), String.class),
                        field(name("p", "content_type"), String.class),
                        field(name("d", "content_json"), JSONB.class),
                        field(name("d", "plain_text"), String.class),
                        field(name("d", "updated_at"), OffsetDateTime.class))
                .from(table(name("pages")).as("p"))
                .join(table(name("page_drafts")).as("d"))
                .on(field(name("d", "page_id"), UUID.class)
                        .eq(field(name("p", "id"), UUID.class)))
                .where(field(name("p", "id"), UUID.class)
                        .eq(pageId)
                        .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNull()))
                .fetchOne(record -> new ContentSnapshot(
                        record.value1(),
                        null,
                        record.value2(),
                        ContentType.valueOf(record.value3()),
                        jsonValue(record.value4()),
                        record.value5(),
                        record.value6()));
    }

    ContentSnapshot publicationSnapshot(UUID publicationId, UUID expectedPageId) {
        return dsl.select(
                        field(name("id"), UUID.class),
                        field(name("page_id"), UUID.class),
                        field(name("title_snapshot"), String.class),
                        field(name("content_type"), String.class),
                        field(name("content_snapshot"), JSONB.class),
                        field(name("plain_text_snapshot"), String.class),
                        field(name("published_at"), OffsetDateTime.class))
                .from(table(name("page_publications")))
                .where(field(name("id"), UUID.class)
                        .eq(publicationId)
                        .and(field(name("page_id"), UUID.class).eq(expectedPageId)))
                .fetchOne(record -> new ContentSnapshot(
                        record.value2(),
                        record.value1(),
                        record.value3(),
                        ContentType.valueOf(record.value4()),
                        jsonValue(record.value5()),
                        record.value6(),
                        record.value7()));
    }

    boolean publicationBelongsToPage(UUID publicationId, UUID pageId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("page_publications")))
                .where(field(name("id"), UUID.class)
                        .eq(publicationId)
                        .and(field(name("page_id"), UUID.class).eq(pageId))));
    }

    List<StoredPageReference> workspaceDraftReferences(UUID workspaceId) {
        return selectReferences()
                .where(uuid("workspace_id")
                        .eq(workspaceId)
                        .and(string("source_scope").eq("DRAFT")))
                .fetch(this::mapReference);
    }

    private void insert(
            UUID workspaceId,
            UUID sourcePageId,
            String sourceScope,
            long sourceRevision,
            UUID sourcePublicationId,
            UUID targetPageId,
            String targetBlockId,
            ReferenceKind kind,
            EmbedMode mode,
            UUID fixedPublicationId,
            String sourcePointer,
            JsonNode displaySettings,
            int ordinal,
            OffsetDateTime now) {
        dsl.insertInto(REFERENCES)
                .columns(
                        uuid("id"),
                        uuid("workspace_id"),
                        uuid("source_page_id"),
                        string("source_scope"),
                        number("source_revision_no"),
                        uuid("source_publication_id"),
                        uuid("target_page_id"),
                        string("target_block_id"),
                        string("reference_kind"),
                        string("embed_mode"),
                        uuid("fixed_publication_id"),
                        string("source_pointer"),
                        json("display_settings"),
                        integer("ordinal_no"),
                        time("created_at"))
                .values(
                        Ids.next(),
                        workspaceId,
                        sourcePageId,
                        sourceScope,
                        sourceRevision,
                        sourcePublicationId,
                        targetPageId,
                        targetBlockId,
                        kind.name(),
                        mode.name(),
                        fixedPublicationId,
                        sourcePointer,
                        JSONB.valueOf(objectMapper.writeValueAsString(displaySettings)),
                        ordinal,
                        now)
                .execute();
    }

    private org.jooq.SelectJoinStep<? extends Record> selectReferences() {
        return dsl.select(
                        uuid("id"),
                        uuid("workspace_id"),
                        uuid("source_page_id"),
                        string("source_scope"),
                        number("source_revision_no"),
                        uuid("source_publication_id"),
                        uuid("target_page_id"),
                        string("target_block_id"),
                        string("reference_kind"),
                        string("embed_mode"),
                        uuid("fixed_publication_id"),
                        string("source_pointer"),
                        json("display_settings"),
                        integer("ordinal_no"),
                        time("created_at"))
                .from(REFERENCES);
    }

    private StoredPageReference mapReference(Record record) {
        return new StoredPageReference(
                record.get(uuid("id")),
                record.get(uuid("workspace_id")),
                record.get(uuid("source_page_id")),
                record.get(string("source_scope")),
                record.get(number("source_revision_no")),
                record.get(uuid("source_publication_id")),
                record.get(uuid("target_page_id")),
                record.get(string("target_block_id")),
                ReferenceKind.valueOf(record.get(string("reference_kind"))),
                EmbedMode.valueOf(record.get(string("embed_mode"))),
                record.get(uuid("fixed_publication_id")),
                record.get(string("source_pointer")),
                jsonValue(record.get(json("display_settings"))),
                record.get(integer("ordinal_no")),
                record.get(time("created_at")));
    }

    private JsonNode jsonValue(JSONB value) {
        return value == null ? null : objectMapper.readTree(value.data());
    }

    private static org.jooq.Field<UUID> uuid(String value) {
        return field(name(value), UUID.class);
    }

    private static org.jooq.Field<String> string(String value) {
        return field(name(value), String.class);
    }

    private static org.jooq.Field<Long> number(String value) {
        return field(name(value), Long.class);
    }

    private static org.jooq.Field<Integer> integer(String value) {
        return field(name(value), Integer.class);
    }

    private static org.jooq.Field<OffsetDateTime> time(String value) {
        return field(name(value), OffsetDateTime.class);
    }

    private static org.jooq.Field<JSONB> json(String value) {
        return field(name(value), JSONB.class);
    }

    record PageMetadata(
            UUID pageId,
            UUID workspaceId,
            UUID knowledgeBaseId,
            String title,
            ContentType contentType,
            String path,
            UUID publishedRevisionId,
            OffsetDateTime updatedAt) {}

    record ContentSnapshot(
            UUID pageId,
            UUID publicationId,
            String title,
            ContentType contentType,
            JsonNode content,
            String plainText,
            OffsetDateTime snapshotAt) {}
}
