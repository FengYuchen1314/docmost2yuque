package io.knowledge.platform.quicknote;

import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.selectOne;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Repository
class QuickNoteRepository {

    private static final Table<Record> NOTES = table(name("quick_notes"));
    private static final Table<Record> REVISIONS = table(name("quick_note_revisions"));
    private static final Table<Record> TAGS = table(name("quick_note_tags"));
    private static final Table<Record> TAG_LINKS = table(name("quick_note_tag_links"));
    private static final Table<Record> CONVERSIONS = table(name("quick_note_conversions"));
    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    QuickNoteRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    void insert(
            UUID id,
            UUID workspaceId,
            UUID userId,
            JsonNode content,
            String plainText,
            String source,
            UUID clientRequestId,
            OffsetDateTime now) {
        dsl.insertInto(NOTES)
                .columns(
                        uuid("id"), uuid("workspace_id"), uuid("user_id"), json("content_json"),
                        string("plain_text"), string("status"), string("source"), number("revision_no"),
                        uuid("client_request_id"), time("created_at"), time("updated_at"))
                .values(
                        id, workspaceId, userId, jsonValue(content), plainText, "ACTIVE", source, 1L,
                        clientRequestId, now, now)
                .execute();
    }

    QuickNoteView findByClientRequest(UUID userId, UUID requestId) {
        if (requestId == null) return null;
        return selectNotes()
                .and(field(name("n", "user_id"), UUID.class).eq(userId))
                .and(field(name("n", "client_request_id"), UUID.class).eq(requestId))
                .fetchOne(this::note);
    }

    QuickNoteView findOwned(UUID noteId, UUID userId) {
        return selectNotes()
                .and(field(name("n", "id"), UUID.class).eq(noteId))
                .and(field(name("n", "user_id"), UUID.class).eq(userId))
                .fetchOne(this::note);
    }

    List<QuickNoteView> list(
            UUID userId,
            String status,
            UUID tagId,
            String query,
            int limit,
            int offset) {
        Condition condition = field(name("n", "user_id"), UUID.class).eq(userId)
                .and(field(name("n", "status"), String.class).eq(status));
        if (tagId != null) {
            condition = condition.and(exists(selectOne()
                    .from(table(name("quick_note_tag_links")).as("filter_link"))
                    .where(field(name("filter_link", "quick_note_id"), UUID.class)
                            .eq(field(name("n", "id"), UUID.class)))
                    .and(field(name("filter_link", "tag_id"), UUID.class).eq(tagId))));
        }
        if (query != null && !query.isBlank()) {
            condition = condition.and(field(name("n", "plain_text"), String.class)
                    .containsIgnoreCase(query.trim()));
        }
        return dsl.select(
                        field(name("n", "id"), UUID.class),
                        field(name("n", "workspace_id"), UUID.class),
                        field(name("n", "user_id"), UUID.class),
                        field(name("n", "content_json"), JSONB.class),
                        field(name("n", "plain_text"), String.class),
                        field(name("n", "status"), String.class),
                        field(name("n", "source"), String.class),
                        field(name("n", "revision_no"), Long.class),
                        field(name("n", "created_at"), OffsetDateTime.class),
                        field(name("n", "updated_at"), OffsetDateTime.class),
                        field(name("n", "archived_at"), OffsetDateTime.class),
                        field(name("n", "deleted_at"), OffsetDateTime.class))
                .from(table(name("quick_notes")).as("n"))
                .where(condition)
                .orderBy(field(name("n", "updated_at")).desc(), field(name("n", "id")).desc())
                .limit(limit)
                .offset(offset)
                .fetch(this::note);
    }

    boolean updateContent(
            UUID noteId,
            UUID userId,
            long expectedRevision,
            JsonNode content,
            String plainText,
            OffsetDateTime now) {
        return dsl.update(NOTES)
                        .set(json("content_json"), jsonValue(content))
                        .set(string("plain_text"), plainText)
                        .set(number("revision_no"), expectedRevision + 1)
                        .set(time("updated_at"), now)
                        .where(uuid("id").eq(noteId)
                                .and(uuid("user_id").eq(userId))
                                .and(number("revision_no").eq(expectedRevision))
                                .and(string("status").eq("ACTIVE")))
                        .execute()
                == 1;
    }

    void insertRevision(
            UUID revisionId,
            UUID noteId,
            long revision,
            String kind,
            JsonNode content,
            String plainText,
            OffsetDateTime now) {
        dsl.insertInto(REVISIONS)
                .columns(
                        uuid("id"), uuid("quick_note_id"), number("revision_no"),
                        string("revision_kind"), json("content_json"), string("plain_text"),
                        time("created_at"))
                .values(revisionId, noteId, revision, kind, jsonValue(content), plainText, now)
                .execute();
    }

    List<QuickNoteRevisionView> history(UUID noteId, int limit, int offset) {
        return dsl.selectFrom(REVISIONS)
                .where(uuid("quick_note_id").eq(noteId))
                .orderBy(number("revision_no").desc())
                .limit(limit)
                .offset(Math.max(0, offset))
                .fetch(this::revision);
    }

    QuickNoteRevisionView revision(UUID noteId, long revision) {
        return dsl.selectFrom(REVISIONS)
                .where(uuid("quick_note_id").eq(noteId).and(number("revision_no").eq(revision)))
                .fetchOne(this::revision);
    }

    boolean setStatus(UUID noteId, UUID userId, String status, OffsetDateTime now) {
        var update = dsl.update(NOTES)
                .set(string("status"), status)
                .set(time("updated_at"), now)
                .set(time("archived_at"), "ARCHIVED".equals(status) ? now : null)
                .set(time("deleted_at"), "DELETED".equals(status) ? now : null);
        return update.where(uuid("id").eq(noteId).and(uuid("user_id").eq(userId))).execute() == 1;
    }

    List<QuickNoteTagView> tags(UUID userId) {
        return dsl.selectFrom(TAGS)
                .where(uuid("user_id").eq(userId))
                .orderBy(string("name").asc())
                .fetch(this::tag);
    }

    QuickNoteTagView findTag(UUID tagId, UUID userId) {
        return dsl.selectFrom(TAGS)
                .where(uuid("id").eq(tagId).and(uuid("user_id").eq(userId)))
                .fetchOne(this::tag);
    }

    void insertTag(UUID id, UUID userId, String tagName, String color, OffsetDateTime now) {
        dsl.insertInto(TAGS)
                .columns(uuid("id"), uuid("user_id"), string("name"), string("color"), time("created_at"), time("updated_at"))
                .values(id, userId, tagName, color, now, now)
                .execute();
    }

    boolean updateTag(UUID id, UUID userId, String tagName, String color, OffsetDateTime now) {
        return dsl.update(TAGS)
                        .set(string("name"), tagName)
                        .set(string("color"), color)
                        .set(time("updated_at"), now)
                        .where(uuid("id").eq(id).and(uuid("user_id").eq(userId)))
                        .execute()
                == 1;
    }

    boolean deleteTag(UUID id, UUID userId) {
        return dsl.deleteFrom(TAGS)
                        .where(uuid("id").eq(id).and(uuid("user_id").eq(userId)))
                        .execute()
                == 1;
    }

    boolean hasTagLink(UUID noteId, UUID tagId) {
        return dsl.fetchExists(selectOne().from(TAG_LINKS)
                .where(uuid("quick_note_id").eq(noteId).and(uuid("tag_id").eq(tagId))));
    }

    void setTag(UUID noteId, UUID tagId, boolean selected, OffsetDateTime now) {
        if (selected) {
            dsl.insertInto(TAG_LINKS)
                    .columns(uuid("quick_note_id"), uuid("tag_id"), time("created_at"))
                    .values(noteId, tagId, now)
                    .onConflict(uuid("quick_note_id"), uuid("tag_id"))
                    .doNothing()
                    .execute();
        } else {
            dsl.deleteFrom(TAG_LINKS)
                    .where(uuid("quick_note_id").eq(noteId).and(uuid("tag_id").eq(tagId)))
                    .execute();
        }
    }

    void insertConversion(UUID noteId, UUID pageId, OffsetDateTime now) {
        dsl.insertInto(CONVERSIONS)
                .columns(uuid("quick_note_id"), uuid("page_id"), time("converted_at"))
                .values(noteId, pageId, now)
                .onConflict(uuid("quick_note_id"), uuid("page_id"))
                .doNothing()
                .execute();
    }

    private org.jooq.SelectConditionStep<? extends Record> selectNotes() {
        return dsl.select(
                        field(name("n", "id"), UUID.class),
                        field(name("n", "workspace_id"), UUID.class),
                        field(name("n", "user_id"), UUID.class),
                        field(name("n", "content_json"), JSONB.class),
                        field(name("n", "plain_text"), String.class),
                        field(name("n", "status"), String.class),
                        field(name("n", "source"), String.class),
                        field(name("n", "revision_no"), Long.class),
                        field(name("n", "created_at"), OffsetDateTime.class),
                        field(name("n", "updated_at"), OffsetDateTime.class),
                        field(name("n", "archived_at"), OffsetDateTime.class),
                        field(name("n", "deleted_at"), OffsetDateTime.class))
                .from(table(name("quick_notes")).as("n"))
                .where(field(name("n", "id"), UUID.class).isNotNull());
    }

    private QuickNoteView note(Record record) {
        UUID id = record.get(field(name("n", "id"), UUID.class));
        return new QuickNoteView(
                id,
                record.get(field(name("n", "workspace_id"), UUID.class)),
                record.get(field(name("n", "user_id"), UUID.class)),
                objectMapper.readTree(record.get(field(name("n", "content_json"), JSONB.class)).data()),
                record.get(field(name("n", "plain_text"), String.class)),
                record.get(field(name("n", "status"), String.class)),
                record.get(field(name("n", "source"), String.class)),
                record.get(field(name("n", "revision_no"), Long.class)),
                noteTags(id),
                record.get(field(name("n", "created_at"), OffsetDateTime.class)),
                record.get(field(name("n", "updated_at"), OffsetDateTime.class)),
                record.get(field(name("n", "archived_at"), OffsetDateTime.class)),
                record.get(field(name("n", "deleted_at"), OffsetDateTime.class)));
    }

    private List<QuickNoteTagView> noteTags(UUID noteId) {
        return dsl.select(
                        field(name("t", "id"), UUID.class),
                        field(name("t", "name"), String.class),
                        field(name("t", "color"), String.class),
                        field(name("t", "created_at"), OffsetDateTime.class),
                        field(name("t", "updated_at"), OffsetDateTime.class))
                .from(table(name("quick_note_tags")).as("t"))
                .join(table(name("quick_note_tag_links")).as("l"))
                .on(field(name("l", "tag_id"), UUID.class).eq(field(name("t", "id"), UUID.class)))
                .where(field(name("l", "quick_note_id"), UUID.class).eq(noteId))
                .orderBy(field(name("t", "name")).asc())
                .fetch(this::tag);
    }

    private QuickNoteTagView tag(Record record) {
        return new QuickNoteTagView(
                record.get(uuid("id")), record.get(string("name")), record.get(string("color")),
                record.get(time("created_at")), record.get(time("updated_at")));
    }

    private QuickNoteRevisionView revision(Record record) {
        return new QuickNoteRevisionView(
                record.get(uuid("id")), record.get(uuid("quick_note_id")),
                record.get(number("revision_no")), record.get(string("revision_kind")),
                objectMapper.readTree(record.get(json("content_json")).data()),
                record.get(string("plain_text")), record.get(time("created_at")));
    }

    private JSONB jsonValue(JsonNode value) {
        return JSONB.valueOf(objectMapper.writeValueAsString(value));
    }

    private static org.jooq.Field<UUID> uuid(String value) { return field(name(value), UUID.class); }
    private static org.jooq.Field<String> string(String value) { return field(name(value), String.class); }
    private static org.jooq.Field<Long> number(String value) { return field(name(value), Long.class); }
    private static org.jooq.Field<OffsetDateTime> time(String value) { return field(name(value), OffsetDateTime.class); }
    private static org.jooq.Field<JSONB> json(String value) { return field(name(value), JSONB.class); }
}
