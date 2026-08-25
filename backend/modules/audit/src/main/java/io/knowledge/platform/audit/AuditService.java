package io.knowledge.platform.audit;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import io.knowledge.platform.common.Ids;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Table;
import org.springframework.stereotype.Service;

@Service
public class AuditService {

    private static final Table<org.jooq.Record> EVENTS = table(name("audit_events"));
    private final DSLContext dsl;
    private final Clock clock;

    public AuditService(DSLContext dsl, Clock clock) {
        this.dsl = dsl;
        this.clock = clock;
    }

    public void success(
            UUID workspaceId,
            UUID actorId,
            String action,
            String resourceType,
            UUID resourceId) {
        record(workspaceId, actorId, action, resourceType, resourceId, "SUCCESS", "{}");
    }

    public void record(
            UUID workspaceId,
            UUID actorId,
            String action,
            String resourceType,
            UUID resourceId,
            String outcome,
            String detailsJson) {
        dsl.insertInto(EVENTS)
                .columns(
                        field(name("id"), UUID.class),
                        field(name("workspace_id"), UUID.class),
                        field(name("actor_id"), UUID.class),
                        field(name("action"), String.class),
                        field(name("resource_type"), String.class),
                        field(name("resource_id"), UUID.class),
                        field(name("outcome"), String.class),
                        field(name("details"), JSONB.class),
                        field(name("occurred_at"), OffsetDateTime.class))
                .values(
                        Ids.next(),
                        workspaceId,
                        actorId,
                        action,
                        resourceType,
                        resourceId,
                        outcome,
                        JSONB.valueOf(detailsJson == null ? "{}" : detailsJson),
                        OffsetDateTime.now(clock))
                .execute();
    }

    public List<AuditEventView> list(UUID workspaceId, int limit) {
        return list(workspaceId, limit, 0);
    }

    public AuditEventPageView page(UUID workspaceId, int limit, int offset) {
        return page(workspaceId, null, null, limit, offset);
    }

    public AuditEventPageView pageForResource(
            UUID workspaceId,
            String resourceType,
            UUID resourceId,
            int limit,
            int offset) {
        if (resourceType == null || resourceType.isBlank() || resourceId == null) {
            throw new IllegalArgumentException("Audit resource type and id are required");
        }
        return page(workspaceId, resourceType, resourceId, limit, offset);
    }

    private AuditEventPageView page(
            UUID workspaceId,
            String resourceType,
            UUID resourceId,
            int limit,
            int offset) {
        int count = Math.max(1, Math.min(limit, 50));
        int start = Math.max(0, Math.min(offset, 1_000_000));
        List<AuditEventView> rows = list(
                workspaceId, resourceType, resourceId, count + 1, start);
        boolean hasMore = rows.size() > count;
        List<AuditEventView> items = List.copyOf(
                rows.subList(0, Math.min(rows.size(), count)));
        return new AuditEventPageView(items, start + items.size(), hasMore);
    }

    private List<AuditEventView> list(UUID workspaceId, int limit, int offset) {
        return list(workspaceId, null, null, limit, offset);
    }

    private List<AuditEventView> list(
            UUID workspaceId,
            String resourceType,
            UUID resourceId,
            int limit,
            int offset) {
        int safeLimit = Math.max(1, Math.min(limit, 200));
        org.jooq.Condition condition =
                field(name("workspace_id"), UUID.class).eq(workspaceId);
        if (resourceType != null) {
            condition = condition
                    .and(field(name("resource_type"), String.class).eq(resourceType))
                    .and(field(name("resource_id"), UUID.class).eq(resourceId));
        }
        return dsl.select(
                        field(name("id"), UUID.class),
                        field(name("workspace_id"), UUID.class),
                        field(name("actor_id"), UUID.class),
                        field(name("action"), String.class),
                        field(name("resource_type"), String.class),
                        field(name("resource_id"), UUID.class),
                        field(name("outcome"), String.class),
                        field(name("details"), JSONB.class),
                        field(name("occurred_at"), OffsetDateTime.class))
                .from(EVENTS)
                .where(condition)
                .orderBy(
                        field(name("occurred_at")).desc(),
                        field(name("id"), UUID.class).desc())
                .limit(safeLimit)
                .offset(Math.max(0, offset))
                .fetch(record -> new AuditEventView(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        record.value5(),
                        record.value6(),
                        record.value7(),
                        record.value8().data(),
                        record.value9()));
    }
}
