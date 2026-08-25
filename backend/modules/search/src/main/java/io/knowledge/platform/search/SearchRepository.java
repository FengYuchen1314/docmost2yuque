package io.knowledge.platform.search;

import static org.jooq.impl.DSL.condition;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.jooq.impl.DSL.val;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

@Repository
class SearchRepository {

    private static final Table<Record> DOCUMENTS = table(name("search_documents"));
    private final DSLContext dsl;

    SearchRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    void upsert(
            SearchDocumentCommand command,
            OffsetDateTime indexedAt,
            ObjectMapper objectMapper) {
        String[] labels = command.labels().stream()
                .filter(value -> value != null && !value.isBlank())
                .map(String::trim)
                .distinct()
                .limit(100)
                .toArray(String[]::new);
        JSONB metadata = JSONB.valueOf(objectMapper.writeValueAsString(
                command.metadata() == null ? objectMapper.createObjectNode() : command.metadata()));
        dsl.insertInto(DOCUMENTS)
                .columns(
                        uuid("id"),
                        uuid("workspace_id"),
                        string("resource_type"),
                        uuid("resource_id"),
                        string("source_scope"),
                        string("title"),
                        string("body"),
                        textArray("labels"),
                        string("path"),
                        uuid("owner_id"),
                        string("content_type"),
                        string("visibility"),
                        uuid("publication_id"),
                        number("permission_version"),
                        json("metadata"),
                        bool("active"),
                        time("source_created_at"),
                        time("source_updated_at"),
                        time("indexed_at"))
                .values(
                        command.id(),
                        command.workspaceId(),
                        command.resourceType(),
                        command.resourceId(),
                        command.sourceScope(),
                        command.title(),
                        abbreviate(command.body(), 2_000_000),
                        labels,
                        command.path(),
                        command.ownerId(),
                        command.contentType(),
                        command.visibility(),
                        command.publicationId(),
                        command.permissionVersion(),
                        metadata,
                        true,
                        command.sourceCreatedAt(),
                        command.sourceUpdatedAt(),
                        indexedAt)
                .onConflict(uuid("id"))
                .doUpdate()
                .set(uuid("workspace_id"), command.workspaceId())
                .set(string("resource_type"), command.resourceType())
                .set(uuid("resource_id"), command.resourceId())
                .set(string("source_scope"), command.sourceScope())
                .set(string("title"), command.title())
                .set(string("body"), abbreviate(command.body(), 2_000_000))
                .set(textArray("labels"), labels)
                .set(string("path"), command.path())
                .set(uuid("owner_id"), command.ownerId())
                .set(string("content_type"), command.contentType())
                .set(string("visibility"), command.visibility())
                .set(uuid("publication_id"), command.publicationId())
                .set(number("permission_version"), command.permissionVersion())
                .set(json("metadata"), metadata)
                .set(bool("active"), true)
                .set(time("source_created_at"), command.sourceCreatedAt())
                .set(time("source_updated_at"), command.sourceUpdatedAt())
                .set(time("indexed_at"), indexedAt)
                .execute();
    }

    void delete(UUID documentId) {
        dsl.deleteFrom(DOCUMENTS).where(uuid("id").eq(documentId)).execute();
    }

    void deletePublications(UUID resourceId) {
        dsl.deleteFrom(DOCUMENTS)
                .where(uuid("resource_id")
                        .eq(resourceId)
                        .and(string("source_scope").eq("PUBLISHED")))
                .execute();
    }

    void deleteKnowledgeBase(UUID knowledgeBaseId) {
        dsl.deleteFrom(DOCUMENTS)
                .where(string("resource_type")
                        .eq("KNOWLEDGE_BASE")
                        .and(uuid("resource_id").eq(knowledgeBaseId))
                        .or(condition("{0}->>'knowledgeBaseId' = {1}", json("metadata"), val(knowledgeBaseId.toString()))))
                .execute();
    }

    void deleteWorkspace(UUID workspaceId) {
        dsl.deleteFrom(DOCUMENTS).where(uuid("workspace_id").eq(workspaceId)).execute();
    }

    void updateLabels(
            UUID workspaceId,
            String resourceType,
            UUID resourceId,
            String[] labels,
            OffsetDateTime sourceUpdatedAt,
            OffsetDateTime indexedAt) {
        dsl.update(DOCUMENTS)
                .set(textArray("labels"), labels)
                .set(time("source_updated_at"), sourceUpdatedAt)
                .set(time("indexed_at"), indexedAt)
                .where(uuid("workspace_id")
                        .eq(workspaceId)
                        .and(string("resource_type").eq(resourceType))
                        .and(uuid("resource_id").eq(resourceId)))
                .execute();
    }

    void updatePagePublicationStatus(UUID pageId, String status, OffsetDateTime indexedAt) {
        dsl.update(DOCUMENTS)
                .set(json("metadata"), field(
                        "jsonb_set({0}, '{publicationStatus}', to_jsonb({1}::text), true)",
                        JSONB.class,
                        json("metadata"),
                        val(status)))
                .set(time("indexed_at"), indexedAt)
                .where(string("resource_type").eq("PAGE")
                        .and(uuid("resource_id").eq(pageId))
                        .and(string("source_scope").eq("DRAFT")))
                .execute();
    }

    List<SearchCandidate> search(
            UUID workspaceId,
            String query,
            Set<String> resourceTypes,
            Set<String> scopes,
            int offset,
            int limit,
            boolean publicOnly,
            UUID knowledgeBaseFilter,
            UUID creatorFilter,
            OffsetDateTime updatedFrom,
            OffsetDateTime updatedTo) {
        if (!resourceTypes.contains("USER")) {
            return searchDocuments(
                    workspaceId, query, resourceTypes, scopes, offset, limit, publicOnly,
                    knowledgeBaseFilter, creatorFilter, updatedFrom, updatedTo);
        }
        int window = Math.min(1_200, Math.max(1, Math.max(0, offset) + limit));
        Set<String> documentTypes = new HashSet<>(resourceTypes);
        documentTypes.remove("USER");
        List<SearchCandidate> merged = new ArrayList<>(window * 2);
        if (!documentTypes.isEmpty()) {
            merged.addAll(searchDocuments(
                    workspaceId, query, documentTypes, scopes, 0, window, publicOnly,
                    knowledgeBaseFilter, creatorFilter, updatedFrom, updatedTo));
        }
        if (!publicOnly && workspaceId != null && knowledgeBaseFilter == null && scopes.contains("CANONICAL")) {
            merged.addAll(searchMembers(workspaceId, query, window, creatorFilter, updatedFrom, updatedTo));
        }
        merged.sort(Comparator.comparingDouble(SearchCandidate::score).reversed()
                .thenComparing(SearchCandidate::updatedAt, Comparator.reverseOrder())
                .thenComparing(SearchCandidate::documentId));
        int start = Math.min(Math.max(0, offset), merged.size());
        int end = Math.min(start + Math.max(1, limit), merged.size());
        return List.copyOf(merged.subList(start, end));
    }

    private List<SearchCandidate> searchDocuments(
            UUID workspaceId,
            String query,
            Set<String> resourceTypes,
            Set<String> scopes,
            int offset,
            int limit,
            boolean publicOnly,
            UUID knowledgeBaseFilter,
            UUID creatorFilter,
            OffsetDateTime updatedFrom,
            OffsetDateTime updatedTo) {
        Field<String> title = string("title");
        Field<String> body = string("body");
        Field<String[]> labels = textArray("labels");
        Field<Object> vector = field(name("search_vector"));
        Field<UUID> knowledgeBaseId = field(
                "nullif({0}->>'knowledgeBaseId', '')::uuid",
                UUID.class,
                json("metadata"));
        Field<UUID> parentPageId = field(
                "nullif({0}->>'pageId', '')::uuid",
                UUID.class,
                json("metadata"));
        Field<String> publicationStatus = field(
                "{0}->>'publicationStatus'", String.class, json("metadata"));
        String contains = "%" + query + "%";
        Condition matches = condition(
                        "{0} @@ websearch_to_tsquery('simple', {1})", vector, val(query))
                .or(field("lower({0})", String.class, title)
                        .likeIgnoreCase(contains))
                .or(field("lower({0})", String.class, body)
                        .likeIgnoreCase(contains))
                .or(condition(
                        "exists (select 1 from unnest({0}) label where lower(label) like lower({1}))",
                        labels,
                        val(contains)))
                .or(field("similarity(lower({0}), lower({1}))", Double.class, title, val(query))
                        .gt(0.18));
        Condition filters = bool("active")
                .isTrue()
                .and(matches)
                .and(string("resource_type").in(resourceTypes))
                .and(string("source_scope").in(scopes));
        if (workspaceId != null) {
            filters = filters.and(uuid("workspace_id").eq(workspaceId));
        }
        if (knowledgeBaseFilter != null) filters = filters.and(knowledgeBaseId.eq(knowledgeBaseFilter));
        if (creatorFilter != null) filters = filters.and(uuid("owner_id").eq(creatorFilter));
        if (updatedFrom != null) filters = filters.and(time("source_updated_at").ge(updatedFrom));
        if (updatedTo != null) filters = filters.and(time("source_updated_at").le(updatedTo));
        if (publicOnly) {
            filters = filters.and(string("source_scope")
                    .eq("PUBLISHED")
                    .and(string("visibility").eq("PUBLIC")));
        }
        Field<Double> score = field(
                "(case when lower({0}) = lower({1}) then 100.0 "
                        + "when lower({0}) like lower({2}) then 60.0 else 0.0 end "
                        + "+ similarity(lower({0}), lower({1})) * 20.0 "
                        + "+ ts_rank_cd({3}, websearch_to_tsquery('simple', {1})) * 10.0)",
                Double.class,
                title,
                val(query),
                val(contains),
                vector);
        return dsl.select(
                        uuid("id"),
                        uuid("workspace_id"),
                        string("resource_type"),
                        uuid("resource_id"),
                        string("source_scope"),
                        title,
                        body,
                        string("path"),
                        uuid("owner_id"),
                        string("content_type"),
                        string("visibility"),
                        uuid("publication_id"),
                        knowledgeBaseId,
                        parentPageId,
                        publicationStatus,
                        score,
                        time("source_updated_at"))
                .from(DOCUMENTS)
                .where(filters)
                .orderBy(score.desc(), time("source_updated_at").desc(), uuid("id").asc())
                .offset(Math.max(0, offset))
                .limit(Math.max(1, Math.min(limit, 1_200)))
                .fetch(record -> new SearchCandidate(
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
                        record.value13(),
                        record.value14(),
                        record.value15(),
                        record.value16(),
                        record.value17()));
    }

    private List<SearchCandidate> searchMembers(
            UUID workspaceId,
            String query,
            int limit,
            UUID creatorFilter,
            OffsetDateTime updatedFrom,
            OffsetDateTime updatedTo) {
        Field<UUID> userId = field(name("wm", "user_id"), UUID.class);
        Field<UUID> memberWorkspaceId = field(name("wm", "workspace_id"), UUID.class);
        Field<String> email = field(name("u", "email_original"), String.class);
        Field<String> displayName = field(name("u", "display_name"), String.class);
        Field<String> role = field(name("wm", "role"), String.class);
        Field<OffsetDateTime> updatedAt = field(name("wm", "updated_at"), OffsetDateTime.class);
        Field<String> title = field("coalesce(nullif({0},''),{1})", String.class, displayName, email);
        Field<String> body = field("{0} || ' · ' || lower({1})", String.class, email, role);
        String contains = "%" + query + "%";
        Condition matches = title.likeIgnoreCase(contains).or(email.likeIgnoreCase(contains));
        Field<Double> score = field(
                "(case when lower({0})=lower({1}) or lower({2})=lower({1}) then 100.0 "
                        + "when lower({0}) like lower({3}) then 60.0 "
                        + "when lower({2}) like lower({3}) then 50.0 else 0.0 end "
                        + "+ similarity(lower({0}),lower({1}))*20.0)",
                Double.class,
                title,
                val(query),
                email,
                val(contains));
        Condition filters = memberWorkspaceId.eq(workspaceId)
                .and(field(name("u", "status"), String.class).eq("ACTIVE"))
                .and(matches);
        if (creatorFilter != null) filters = filters.and(userId.eq(creatorFilter));
        if (updatedFrom != null) filters = filters.and(updatedAt.ge(updatedFrom));
        if (updatedTo != null) filters = filters.and(updatedAt.le(updatedTo));
        return dsl.select(userId, memberWorkspaceId, title, body, role, updatedAt, score)
                .from(table(name("workspace_memberships")).as("wm"))
                .join(table(name("users")).as("u"))
                .on(field(name("u", "id"), UUID.class).eq(userId))
                .where(filters)
                .orderBy(score.desc(), updatedAt.desc(), userId.asc())
                .limit(Math.max(1, Math.min(limit, 1_200)))
                .fetch(record -> new SearchCandidate(
                        record.get(userId),
                        record.get(memberWorkspaceId),
                        "USER",
                        record.get(userId),
                        "CANONICAL",
                        record.get(title),
                        record.get(body),
                        null,
                        record.get(userId),
                        null,
                        "WORKSPACE",
                        null,
                        null,
                        null,
                        null,
                        record.get(score),
                        record.get(updatedAt)));
    }

    private static String abbreviate(String value, int maximum) {
        if (value == null || value.length() <= maximum) {
            return value == null ? "" : value;
        }
        return value.substring(0, maximum);
    }

    private static Field<UUID> uuid(String value) {
        return field(name(value), UUID.class);
    }

    private static Field<String> string(String value) {
        return field(name(value), String.class);
    }

    private static Field<Long> number(String value) {
        return field(name(value), Long.class);
    }

    private static Field<Boolean> bool(String value) {
        return field(name(value), Boolean.class);
    }

    private static Field<OffsetDateTime> time(String value) {
        return field(name(value), OffsetDateTime.class);
    }

    private static Field<JSONB> json(String value) {
        return field(name(value), JSONB.class);
    }

    private static Field<String[]> textArray(String value) {
        return field(name(value), String[].class);
    }
}
