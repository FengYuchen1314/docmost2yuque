package io.knowledge.platform.engagement;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import io.knowledge.platform.common.Ids;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Repository
class EngagementRepository {

    private static final Table<Record> ACTIVITIES = table(name("activity_events"));
    private static final Table<Record> FAVORITES = table(name("favorites"));
    private static final Table<Record> COMMENTS = table(name("comments"));
    private static final Table<Record> NOTIFICATIONS = table(name("notifications"));
    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    EngagementRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    boolean recordActivity(
            UUID workspaceId,
            UUID actorId,
            String resourceType,
            UUID resourceId,
            String eventType,
            JsonNode metadata,
            OffsetDateTime now,
            OffsetDateTime debounceSince) {
        if (debounceSince != null && dsl.fetchExists(dsl.selectOne()
                .from(ACTIVITIES)
                .where(uuid("actor_id")
                        .eq(actorId)
                        .and(string("resource_type").eq(resourceType))
                        .and(uuid("resource_id").eq(resourceId))
                        .and(string("event_type").eq(eventType))
                        .and(time("occurred_at").ge(debounceSince))))) {
            return false;
        }
        dsl.insertInto(ACTIVITIES)
                .columns(
                        uuid("id"), uuid("workspace_id"), uuid("actor_id"),
                        string("resource_type"), uuid("resource_id"), string("event_type"),
                        json("metadata"), time("occurred_at"))
                .values(
                        Ids.next(), workspaceId, actorId, resourceType, resourceId, eventType,
                        JSONB.valueOf(objectMapper.writeValueAsString(
                                metadata == null ? objectMapper.createObjectNode() : metadata)), now)
                .execute();
        return true;
    }

    boolean favorite(UUID actorId, UUID workspaceId, String resourceType, UUID resourceId, boolean value, OffsetDateTime now) {
        if (value) {
            return dsl.insertInto(FAVORITES)
                            .columns(uuid("user_id"), uuid("workspace_id"), string("resource_type"), uuid("resource_id"), time("created_at"))
                            .values(actorId, workspaceId, resourceType, resourceId, now)
                            .onConflict(uuid("user_id"), string("resource_type"), uuid("resource_id"))
                            .doNothing()
                            .execute()
                    == 1;
        }
        return dsl.deleteFrom(FAVORITES)
                        .where(uuid("user_id").eq(actorId)
                                .and(string("resource_type").eq(resourceType))
                                .and(uuid("resource_id").eq(resourceId)))
                        .execute()
                == 1;
    }

    boolean isFavorite(UUID actorId, String resourceType, UUID resourceId) {
        return dsl.fetchExists(dsl.selectOne().from(FAVORITES)
                .where(uuid("user_id").eq(actorId)
                        .and(string("resource_type").eq(resourceType))
                        .and(uuid("resource_id").eq(resourceId))));
    }

    int clearActivities(UUID actorId, String resourceType, String eventType) {
        return dsl.deleteFrom(ACTIVITIES)
                .where(uuid("actor_id").eq(actorId)
                        .and(string("resource_type").eq(resourceType))
                        .and(string("event_type").eq(eventType)))
                .execute();
    }

    List<WorkbenchItem> workbench(UUID actorId, String reason, int offset, int limit) {
        String eventFilter = switch (reason) {
            case "VIEWED" -> "VIEW";
            case "EDITED" -> "EDIT";
            case "COLLABORATED" -> "COLLABORATE";
            case "CREATED" -> "CREATE";
            default -> null;
        };
        if ("FAVORITE".equals(reason)) {
            return dsl.select(
                            field(name("p", "id"), UUID.class),
                            field(name("p", "workspace_id"), UUID.class),
                            field(name("p", "knowledge_base_id"), UUID.class),
                            field(name("kb", "name"), String.class).as("knowledge_base_name"),
                            field(name("p", "title"), String.class),
                            field(name("p", "path"), String.class),
                            field(name("p", "content_type"), String.class),
                            field("case when p.published_revision_id is null then 'UNPUBLISHED' when p.draft_revision > pp.source_draft_revision then 'CHANGED' else 'PUBLISHED' end", String.class).as("publication_status"),
                            field(name("f", "created_at"), OffsetDateTime.class).as("activity_at"))
                    .from(table(name("favorites")).as("f"))
                    .join(table(name("pages")).as("p"))
                    .on(field(name("p", "id"), UUID.class).eq(field(name("f", "resource_id"), UUID.class)))
                    .join(table(name("knowledge_bases")).as("kb"))
                    .on(field(name("kb", "id"), UUID.class).eq(field(name("p", "knowledge_base_id"), UUID.class)))
                    .leftJoin(table(name("page_publications")).as("pp"))
                    .on(field(name("pp", "id"), UUID.class).eq(field(name("p", "published_revision_id"), UUID.class)))
                    .where(field(name("f", "user_id"), UUID.class).eq(actorId)
                            .and(field(name("f", "resource_type"), String.class).eq("PAGE"))
                            .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNull()))
                    .orderBy(field(name("f", "created_at")).desc())
                    .offset(offset)
                    .limit(limit)
                    .fetch(record -> workbench(record, reason, true));
        }
        return dsl.select(
                        field(name("p", "id"), UUID.class),
                        field(name("p", "workspace_id"), UUID.class),
                        field(name("p", "knowledge_base_id"), UUID.class),
                        field(name("kb", "name"), String.class).as("knowledge_base_name"),
                        field(name("p", "title"), String.class),
                        field(name("p", "path"), String.class),
                        field(name("p", "content_type"), String.class),
                        field("case when p.published_revision_id is null then 'UNPUBLISHED' when p.draft_revision > pp.source_draft_revision then 'CHANGED' else 'PUBLISHED' end", String.class).as("publication_status"),
                        field("max(a.occurred_at)", OffsetDateTime.class).as("activity_at"))
                .from(table(name("activity_events")).as("a"))
                .join(table(name("pages")).as("p"))
                .on(field(name("p", "id"), UUID.class).eq(field(name("a", "resource_id"), UUID.class)))
                .join(table(name("knowledge_bases")).as("kb"))
                .on(field(name("kb", "id"), UUID.class).eq(field(name("p", "knowledge_base_id"), UUID.class)))
                .leftJoin(table(name("page_publications")).as("pp"))
                .on(field(name("pp", "id"), UUID.class).eq(field(name("p", "published_revision_id"), UUID.class)))
                .where(field(name("a", "actor_id"), UUID.class).eq(actorId)
                        .and(field(name("a", "resource_type"), String.class).eq("PAGE"))
                        .and(field(name("a", "event_type"), String.class).eq(eventFilter))
                        .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNull()))
                .groupBy(
                        field(name("p", "id")), field(name("p", "workspace_id")),
                        field(name("p", "knowledge_base_id")), field(name("p", "title")),
                        field(name("p", "path")), field(name("p", "content_type")),
                        field(name("kb", "name")), field(name("p", "published_revision_id")),
                        field(name("p", "draft_revision")), field(name("pp", "source_draft_revision")))
                .orderBy(field("max(a.occurred_at)").desc())
                .offset(offset)
                .limit(limit)
                .fetch(record -> workbench(
                        record,
                        reason,
                        isFavorite(
                                actorId,
                                "PAGE",
                                record.get(field(name("p", "id"), UUID.class)))));
    }

    Map<UUID, List<WorkbenchCollaborator>> collaborators(List<UUID> pageIds) {
        Map<UUID, List<WorkbenchCollaborator>> values = new LinkedHashMap<>();
        if (pageIds.isEmpty()) return values;
        var resourceId = field(name("a", "resource_id"), UUID.class);
        var userId = field(name("u", "id"), UUID.class);
        var displayName = field(name("u", "display_name"), String.class);
        var email = field(name("u", "email_original"), String.class);
        var latest = field("max(a.occurred_at)", OffsetDateTime.class);
        dsl.select(resourceId, userId, displayName, email, latest.as("latest_activity"))
                .from(table(name("activity_events")).as("a"))
                .join(table(name("users")).as("u"))
                .on(userId.eq(field(name("a", "actor_id"), UUID.class)))
                .where(field(name("a", "resource_type"), String.class).eq("PAGE")
                        .and(field(name("a", "event_type"), String.class).in("EDIT", "COLLABORATE", "CREATE"))
                        .and(resourceId.in(pageIds)))
                .groupBy(resourceId, userId, displayName, email)
                .orderBy(resourceId.asc(), latest.desc())
                .fetch()
                .forEach(record -> {
                    List<WorkbenchCollaborator> collaborators = values.computeIfAbsent(record.get(resourceId), ignored -> new java.util.ArrayList<>());
                    if (collaborators.size() < 4) collaborators.add(new WorkbenchCollaborator(record.get(userId), record.get(displayName), record.get(email)));
                });
        return values;
    }

    void insertComment(
            UUID id, UUID workspaceId, UUID pageId, UUID parentId, JsonNode anchor,
            JsonNode body, String plainText, UUID actorId, OffsetDateTime now) {
        dsl.insertInto(COMMENTS)
                .columns(
                        uuid("id"), uuid("workspace_id"), string("resource_type"), uuid("resource_id"),
                        uuid("parent_id"), json("anchor"), json("body_json"), string("plain_text"),
                        string("status"), uuid("created_by"), time("created_at"), time("updated_at"))
                .values(
                        id, workspaceId, "PAGE", pageId, parentId,
                        JSONB.valueOf(objectMapper.writeValueAsString(anchor)),
                        JSONB.valueOf(objectMapper.writeValueAsString(body)), plainText, "OPEN", actorId, now, now)
                .execute();
    }

    CommentView findComment(UUID commentId) {
        return selectComments().and(field(name("c", "id"), UUID.class).eq(commentId)).fetchOne(this::comment);
    }

    List<CommentView> comments(UUID pageId) {
        return comments(pageId, Integer.MAX_VALUE, 0);
    }

    List<CommentView> comments(UUID pageId, int limit, int offset) {
        return selectComments()
                .and(field(name("c", "resource_id"), UUID.class).eq(pageId))
                .orderBy(
                        field(name("c", "created_at")).asc(),
                        field(name("c", "id"), UUID.class).asc())
                .limit(Math.max(1, limit))
                .offset(Math.max(0, offset))
                .fetch(this::comment);
    }

    void updateComment(UUID id, JsonNode body, String plainText, UUID actorId, OffsetDateTime now) {
        int changed = dsl.update(COMMENTS)
                .set(json("body_json"), JSONB.valueOf(objectMapper.writeValueAsString(body)))
                .set(string("plain_text"), plainText)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(id).and(uuid("created_by").eq(actorId)).and(time("deleted_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    void resolveComment(UUID id, UUID actorId, boolean resolved, OffsetDateTime now) {
        int changed = dsl.update(COMMENTS)
                .set(string("status"), resolved ? "RESOLVED" : "OPEN")
                .set(uuid("resolved_by"), resolved ? actorId : null)
                .set(time("resolved_at"), resolved ? now : null)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(id).and(time("deleted_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    void deleteComment(UUID id, OffsetDateTime now) {
        int changed = dsl.update(COMMENTS)
                .set(time("deleted_at"), now)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(id).and(time("deleted_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    boolean workspaceMember(UUID workspaceId, UUID userId) {
        return dsl.fetchExists(dsl.selectOne().from(table(name("workspace_memberships")))
                .where(uuid("workspace_id").eq(workspaceId).and(uuid("user_id").eq(userId))));
    }

    void notify(
            UUID recipientId, UUID workspaceId, String type, UUID actorId,
            String resourceType, UUID resourceId, JsonNode anchor, JsonNode payload,
            String aggregationKey, OffsetDateTime now) {
        dsl.insertInto(NOTIFICATIONS)
                .columns(
                        uuid("id"), uuid("recipient_id"), uuid("workspace_id"), string("notification_type"),
                        uuid("actor_id"), string("resource_type"), uuid("resource_id"), json("anchor"),
                        json("payload"), string("aggregation_key"), integer("occurrence_count"),
                        time("created_at"), time("updated_at"))
                .values(
                        Ids.next(), recipientId, workspaceId, type, actorId, resourceType, resourceId,
                        JSONB.valueOf(objectMapper.writeValueAsString(anchor)),
                        JSONB.valueOf(objectMapper.writeValueAsString(payload)), aggregationKey, 1, now, now)
                .onConflict(uuid("recipient_id"), string("aggregation_key"))
                .where(time("read_at").isNull())
                .doUpdate()
                .set(uuid("actor_id"), actorId)
                .set(json("payload"), JSONB.valueOf(objectMapper.writeValueAsString(payload)))
                .set(
                        integer("occurrence_count"),
                        field(name("notifications", "occurrence_count"), Integer.class).plus(1))
                .set(time("updated_at"), now)
                .execute();
    }

    List<NotificationView> notifications(
            UUID recipientId, boolean unreadOnly, String category, int offset, int limit) {
        var condition = uuid("recipient_id").eq(recipientId);
        if (unreadOnly) condition = condition.and(time("read_at").isNull());
        var type = string("notification_type");
        condition = switch (category) {
            case "MENTIONS" -> condition.and(type.in("COMMENT_MENTION", "PAGE_MENTION"));
            case "COMMENTS" -> condition.and(type.in("COMMENT_REPLY", "SHARE_COMMENT"));
            case "ACCESS" -> condition.and(type.in(
                    "INVITATION", "APPROVAL", "SHARE_APPROVAL_REQUEST",
                    "SHARE_APPROVAL_REVIEWED", "SHARE_INVITE_ACCEPTED"));
            case "UPDATES" -> condition.and(type.notIn(
                    "COMMENT_MENTION", "PAGE_MENTION", "COMMENT_REPLY", "SHARE_COMMENT",
                    "INVITATION", "APPROVAL", "SHARE_APPROVAL_REQUEST",
                    "SHARE_APPROVAL_REVIEWED", "SHARE_INVITE_ACCEPTED"));
            default -> condition;
        };
        return dsl.selectFrom(NOTIFICATIONS).where(condition)
                .orderBy(time("updated_at").desc(), uuid("id").desc())
                .offset(offset).limit(limit).fetch(this::notification);
    }

    void readNotification(UUID recipientId, UUID notificationId, OffsetDateTime now) {
        int changed = dsl.update(NOTIFICATIONS).set(time("read_at"), now)
                .where(uuid("id").eq(notificationId).and(uuid("recipient_id").eq(recipientId)))
                .execute();
        requireChanged(changed);
    }

    void readAll(UUID recipientId, OffsetDateTime now) {
        dsl.update(NOTIFICATIONS).set(time("read_at"), now)
                .where(uuid("recipient_id").eq(recipientId).and(time("read_at").isNull())).execute();
    }

    private org.jooq.SelectConditionStep<? extends Record> selectComments() {
        return dsl.select(
                        field(name("c", "id"), UUID.class), field(name("c", "workspace_id"), UUID.class),
                        field(name("c", "resource_id"), UUID.class), field(name("c", "parent_id"), UUID.class),
                        field(name("c", "anchor"), JSONB.class), field(name("c", "body_json"), JSONB.class),
                        field(name("c", "plain_text"), String.class), field(name("c", "status"), String.class),
                        field(name("c", "created_by"), UUID.class), field(name("u", "email_normalized"), String.class),
                        field(name("c", "resolved_by"), UUID.class), field(name("c", "resolved_at"), OffsetDateTime.class),
                        field(name("c", "created_at"), OffsetDateTime.class), field(name("c", "updated_at"), OffsetDateTime.class))
                .from(table(name("comments")).as("c"))
                .join(table(name("users")).as("u"))
                .on(field(name("u", "id"), UUID.class).eq(field(name("c", "created_by"), UUID.class)))
                .where(field(name("c", "deleted_at"), OffsetDateTime.class).isNull());
    }

    private CommentView comment(Record record) {
        return new CommentView(
                record.get(field(name("c", "id"), UUID.class)),
                record.get(field(name("c", "workspace_id"), UUID.class)),
                record.get(field(name("c", "resource_id"), UUID.class)),
                record.get(field(name("c", "parent_id"), UUID.class)),
                objectMapper.readTree(record.get(field(name("c", "anchor"), JSONB.class)).data()),
                objectMapper.readTree(record.get(field(name("c", "body_json"), JSONB.class)).data()),
                record.get(field(name("c", "plain_text"), String.class)),
                record.get(field(name("c", "status"), String.class)),
                record.get(field(name("c", "created_by"), UUID.class)),
                record.get(field(name("u", "email_normalized"), String.class)),
                record.get(field(name("c", "resolved_by"), UUID.class)),
                record.get(field(name("c", "resolved_at"), OffsetDateTime.class)),
                record.get(field(name("c", "created_at"), OffsetDateTime.class)),
                record.get(field(name("c", "updated_at"), OffsetDateTime.class)));
    }

    private NotificationView notification(Record record) {
        return new NotificationView(
                record.get(uuid("id")), record.get(uuid("workspace_id")), record.get(string("notification_type")),
                record.get(uuid("actor_id")), record.get(string("resource_type")), record.get(uuid("resource_id")),
                objectMapper.readTree(record.get(json("anchor")).data()),
                objectMapper.readTree(record.get(json("payload")).data()),
                record.get(integer("occurrence_count")), record.get(time("read_at")),
                record.get(time("created_at")), record.get(time("updated_at")));
    }

    private static WorkbenchItem workbench(Record record, String reason, boolean favorite) {
        return new WorkbenchItem(
                record.get(field(name("p", "id"), UUID.class)),
                "PAGE",
                record.get(field(name("p", "workspace_id"), UUID.class)),
                record.get(field(name("p", "knowledge_base_id"), UUID.class)),
                record.get(field(name("knowledge_base_name"), String.class)),
                record.get(field(name("p", "title"), String.class)),
                record.get(field(name("p", "path"), String.class)),
                record.get(field(name("p", "content_type"), String.class)),
                record.get(field(name("publication_status"), String.class)),
                reason,
                record.get(field(name("activity_at"), OffsetDateTime.class)),
                favorite,
                List.of());
    }

    private static org.jooq.Field<UUID> uuid(String value) { return field(name(value), UUID.class); }
    private static org.jooq.Field<String> string(String value) { return field(name(value), String.class); }
    private static org.jooq.Field<Integer> integer(String value) { return field(name(value), Integer.class); }
    private static org.jooq.Field<OffsetDateTime> time(String value) { return field(name(value), OffsetDateTime.class); }
    private static org.jooq.Field<JSONB> json(String value) { return field(name(value), JSONB.class); }
    private static void requireChanged(int changed) {
        if (changed != 1) throw new io.knowledge.platform.authorization.ResourceNotFoundException();
    }
}
