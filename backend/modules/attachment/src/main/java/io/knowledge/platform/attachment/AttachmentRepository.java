package io.knowledge.platform.attachment;

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
class AttachmentRepository {

    private static final Table<Record> ATTACHMENTS = table(name("attachments"));
    private final DSLContext dsl;

    AttachmentRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    UUID pageWorkspace(UUID pageId) {
        return dsl.select(uuid("workspace_id"))
                .from(table(name("pages")))
                .where(uuid("id").eq(pageId).and(time("deleted_at").isNull()))
                .fetchOne(uuid("workspace_id"));
    }

    PageSearchContext pageSearchContext(UUID pageId) {
        if(pageId==null)return null;
        Record record=dsl.fetchOne("select p.workspace_id,p.knowledge_base_id,p.title from pages p join knowledge_bases kb on kb.id=p.knowledge_base_id where p.id=?::uuid and p.deleted_at is null and kb.archived_at is null",pageId);
        return record==null?null:new PageSearchContext(record.get("workspace_id",UUID.class),record.get("knowledge_base_id",UUID.class),record.get("title",String.class));
    }

    void insert(AttachmentRecord value) {
        dsl.insertInto(ATTACHMENTS)
                .columns(
                        uuid("id"), uuid("workspace_id"), uuid("page_id"),
                        string("original_name"), string("media_type"), number("size_bytes"),
                        string("checksum_sha256"), string("storage_key"),
                        uuid("uploaded_by"), string("extracted_text"),string("extraction_status"),time("extracted_at"),time("created_at"))
                .values(
                        value.id(), value.workspaceId(), value.pageId(), value.originalName(),
                        value.mediaType(), value.sizeBytes(), value.checksumSha256(),
                        value.storageKey(), value.uploadedBy(),value.extractedText(),value.extractionStatus(),value.extractedAt(), value.createdAt())
                .execute();
    }

    AttachmentRecord findActive(UUID attachmentId) {
        return select().and(uuid("id").eq(attachmentId)).fetchOne(AttachmentRepository::map);
    }

    List<AttachmentRecord> listPage(UUID pageId) {
        return select().and(uuid("page_id").eq(pageId))
                .orderBy(time("created_at").desc())
                .fetch(AttachmentRepository::map);
    }

    boolean pagePubliclyReadable(UUID pageId, UUID attachmentId) {
        Record result = dsl.fetchOne("""
                select exists (
                    select 1
                    from page_publications publication
                    join publication_attachments publication_attachment
                      on publication_attachment.publication_id = publication.id
                    join pages page on page.id = publication.page_id
                    join knowledge_bases knowledge_base on knowledge_base.id = page.knowledge_base_id
                    join workspaces workspace on workspace.id = page.workspace_id
                    where page.id = ?::uuid
                      and publication_attachment.attachment_id = ?::uuid
                      and page.deleted_at is null
                      and knowledge_base.archived_at is null
                      and workspace.deleted_at is null
                      and publication.superseded_at is null
                      and page.published_revision_id = publication.id
                      and (case when page.visibility_override = 'INHERIT'
                                then knowledge_base.visibility
                                else page.visibility_override end) = 'PUBLIC'
                ) as allowed
                """, pageId, attachmentId);
        return result != null && Boolean.TRUE.equals(result.get("allowed", Boolean.class));
    }

    boolean publicationContainsAttachment(
            UUID pageId, UUID publicationId, UUID attachmentId) {
        Record result = dsl.fetchOne("""
                select exists (
                    select 1
                    from page_publications publication
                    join publication_attachments publication_attachment
                      on publication_attachment.publication_id = publication.id
                    join pages page on page.id = publication.page_id
                    join knowledge_bases knowledge_base on knowledge_base.id = page.knowledge_base_id
                    join workspaces workspace on workspace.id = page.workspace_id
                    where page.id = ?::uuid
                      and publication.id = ?::uuid
                      and publication_attachment.attachment_id = ?::uuid
                      and page.deleted_at is null
                      and knowledge_base.archived_at is null
                      and workspace.deleted_at is null
                      and publication.superseded_at is null
                      and page.published_revision_id = publication.id
                ) as allowed
                """, pageId, publicationId, attachmentId);
        return result != null && Boolean.TRUE.equals(result.get("allowed", Boolean.class));
    }

    boolean softDelete(UUID attachmentId, OffsetDateTime now) {
        return dsl.update(ATTACHMENTS)
                        .set(time("deleted_at"), now)
                        .where(uuid("id").eq(attachmentId).and(time("deleted_at").isNull()))
                        .execute()
                == 1;
    }

    private org.jooq.SelectConditionStep<? extends Record> select() {
        return dsl.select(
                        uuid("id"), uuid("workspace_id"), uuid("page_id"),
                        string("original_name"), string("media_type"), number("size_bytes"),
                        string("checksum_sha256"), string("storage_key"),
                        uuid("uploaded_by"),string("extracted_text"),string("extraction_status"),time("extracted_at"), time("created_at"))
                .from(ATTACHMENTS)
                .where(time("deleted_at").isNull());
    }

    private static AttachmentRecord map(Record record) {
        return new AttachmentRecord(
                record.get(uuid("id")), record.get(uuid("workspace_id")),
                record.get(uuid("page_id")), record.get(string("original_name")),
                record.get(string("media_type")), record.get(number("size_bytes")),
                record.get(string("checksum_sha256")), record.get(string("storage_key")),
                record.get(uuid("uploaded_by")),record.get(string("extracted_text")),record.get(string("extraction_status")),record.get(time("extracted_at")), record.get(time("created_at")));
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

    private static org.jooq.Field<OffsetDateTime> time(String value) {
        return field(name(value), OffsetDateTime.class);
    }

    record AttachmentRecord(
            UUID id,
            UUID workspaceId,
            UUID pageId,
            String originalName,
            String mediaType,
            long sizeBytes,
            String checksumSha256,
            String storageKey,
            UUID uploadedBy,
            String extractedText,
            String extractionStatus,
            OffsetDateTime extractedAt,
            OffsetDateTime createdAt) {}
    record PageSearchContext(UUID workspaceId,UUID knowledgeBaseId,String pageTitle){}
}
