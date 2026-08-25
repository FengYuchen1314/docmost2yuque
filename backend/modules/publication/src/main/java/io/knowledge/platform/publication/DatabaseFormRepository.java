package io.knowledge.platform.publication;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Repository
class DatabaseFormRepository {

    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    DatabaseFormRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    FormTarget target(UUID publicationId) {
        var effectiveVisibility = field(
                "case when {0} = 'INHERIT' then {1} else {0} end",
                String.class,
                field(name("p", "visibility_override"), String.class),
                field(name("kb", "visibility"), String.class));
        var record = dsl.select(
                        field(name("pub", "id"), UUID.class),
                        field(name("pub", "workspace_id"), UUID.class),
                        field(name("pub", "knowledge_base_id"), UUID.class),
                        field(name("pub", "page_id"), UUID.class),
                        field(name("pub", "published_by"), UUID.class),
                        field(name("pub", "content_snapshot"), JSONB.class))
                .from(table(name("page_publications")).as("pub"))
                .join(table(name("pages")).as("p"))
                .on(field(name("p", "id"), UUID.class)
                        .eq(field(name("pub", "page_id"), UUID.class)))
                .join(table(name("knowledge_bases")).as("kb"))
                .on(field(name("kb", "id"), UUID.class)
                        .eq(field(name("pub", "knowledge_base_id"), UUID.class)))
                .where(field(name("pub", "id"), UUID.class)
                        .eq(publicationId)
                        .and(field(name("pub", "content_type"), String.class).eq("DATABASE"))
                        .and(field(name("pub", "superseded_at"), OffsetDateTime.class).isNull())
                        .and(field(name("p", "published_revision_id"), UUID.class).eq(publicationId))
                        .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNull())
                        .and(effectiveVisibility.eq("PUBLIC")))
                .fetchOne();
        if (record == null) return null;
        JSONB content = record.value6();
        return new FormTarget(
                record.value1(),
                record.value2(),
                record.value3(),
                record.value4(),
                record.value5(),
                objectMapper.readTree(content.data()));
    }

    SubmissionRow submission(UUID publicationId, String idempotencyKey) {
        return dsl.select(
                        field(name("row_id"), UUID.class),
                        field(name("created_at"), OffsetDateTime.class))
                .from(table(name("database_form_submissions")))
                .where(field(name("publication_id"), UUID.class)
                        .eq(publicationId)
                        .and(field(name("idempotency_key"), String.class).eq(idempotencyKey)))
                .fetchOne(record -> new SubmissionRow(record.value1(), record.value2()));
    }

    int recentSubmissionCount(UUID pageId, String visitorHash, OffsetDateTime since) {
        return dsl.fetchCount(dsl.selectOne()
                .from(table(name("database_form_submissions")))
                .where(field(name("page_id"), UUID.class)
                        .eq(pageId)
                        .and(field(name("visitor_hash"), String.class).eq(visitorHash))
                        .and(field(name("created_at"), OffsetDateTime.class).ge(since))));
    }

    boolean insert(
            UUID id,
            FormTarget target,
            UUID rowId,
            UUID submitterId,
            String visitorHash,
            String idempotencyKey,
            JsonNode values,
            OffsetDateTime now) {
        return dsl.insertInto(table(name("database_form_submissions")))
                        .columns(
                                field(name("id"), UUID.class),
                                field(name("publication_id"), UUID.class),
                                field(name("page_id"), UUID.class),
                                field(name("row_id"), UUID.class),
                                field(name("submitter_id"), UUID.class),
                                field(name("visitor_hash"), String.class),
                                field(name("idempotency_key"), String.class),
                                field(name("values_json"), JSONB.class),
                                field(name("created_at"), OffsetDateTime.class))
                        .values(
                                id,
                                target.publicationId(),
                                target.pageId(),
                                rowId,
                                submitterId,
                                visitorHash,
                                idempotencyKey,
                                JSONB.valueOf(objectMapper.writeValueAsString(values)),
                                now)
                        .onConflict(
                                field(name("publication_id")),
                                field(name("idempotency_key")))
                        .doNothing()
                        .execute()
                == 1;
    }

    record FormTarget(
            UUID publicationId,
            UUID workspaceId,
            UUID knowledgeBaseId,
            UUID pageId,
            UUID publishedBy,
            JsonNode content) {}

    record SubmissionRow(UUID rowId, OffsetDateTime createdAt) {}
}
