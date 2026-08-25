package io.knowledge.platform.analytics;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class AnalyticsRepository {

    private static final Table<Record> EVENTS = table(name("content_events"));
    private static final Table<Record> METRICS = table(name("daily_content_metrics"));
    private static final Table<Record> UNIQUES = table(name("daily_metric_unique_visitors"));
    private final DSLContext dsl;

    AnalyticsRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    UUID pageKnowledgeBase(UUID pageId) {
        return dsl.select(uuid("knowledge_base_id"))
                .from(table(name("pages")))
                .where(uuid("id").eq(pageId))
                .fetchOne(uuid("knowledge_base_id"));
    }

    void record(UUID id, AnalyticsEventCommand command, JSONB metadata, OffsetDateTime now) {
        String type = command.eventType();
        LocalDate date = now.withOffsetSameInstant(ZoneOffset.UTC).toLocalDate();
        dsl.insertInto(EVENTS)
                .columns(uuid("id"), uuid("workspace_id"), uuid("actor_id"), string("anonymous_visitor_hash"),
                        string("resource_type"), uuid("resource_id"), uuid("knowledge_base_id"), string("event_type"),
                        string("session_id"), json("metadata"), time("occurred_at"))
                .values(id, command.workspaceId(), command.actorId(), command.anonymousVisitorHash(),
                        command.resourceType(), command.resourceId(), command.knowledgeBaseId(), type,
                        command.sessionId(), metadata, now)
                .execute();
        String visitor = command.actorId() == null
                ? "a:" + command.anonymousVisitorHash()
                : "u:" + command.actorId();
        boolean unique = false;
        if ("VIEW".equals(type)) {
            unique = dsl.insertInto(UNIQUES)
                    .columns(uuid("workspace_id"), string("resource_type"), uuid("resource_id"), date("metric_date"), string("visitor_key"), time("created_at"))
                    .values(command.workspaceId(), command.resourceType(), command.resourceId(), date, visitor, now)
                    .onConflictDoNothing()
                    .execute() == 1;
        }
        dsl.insertInto(METRICS)
                .columns(uuid("workspace_id"), string("resource_type"), uuid("resource_id"), date("metric_date"),
                        number("views"), number("unique_views"), number("edits"), number("comments"),
                        number("shares"), number("exports"), number("reactions"), time("updated_at"))
                .values(command.workspaceId(), command.resourceType(), command.resourceId(), date,
                        "VIEW".equals(type) ? 1L : 0L, unique ? 1L : 0L, "EDIT".equals(type) ? 1L : 0L,
                        "COMMENT".equals(type) ? 1L : 0L, "SHARE".equals(type) ? 1L : 0L,
                        "EXPORT".equals(type) ? 1L : 0L, "REACTION".equals(type) ? 1L : 0L, now)
                .onConflict(uuid("workspace_id"), string("resource_type"), uuid("resource_id"), date("metric_date"))
                .doUpdate()
                .set(number("views"), number("daily_content_metrics.views").add("VIEW".equals(type) ? 1L : 0L))
                .set(number("unique_views"), number("daily_content_metrics.unique_views").add(unique ? 1L : 0L))
                .set(number("edits"), number("daily_content_metrics.edits").add("EDIT".equals(type) ? 1L : 0L))
                .set(number("comments"), number("daily_content_metrics.comments").add("COMMENT".equals(type) ? 1L : 0L))
                .set(number("shares"), number("daily_content_metrics.shares").add("SHARE".equals(type) ? 1L : 0L))
                .set(number("exports"), number("daily_content_metrics.exports").add("EXPORT".equals(type) ? 1L : 0L))
                .set(number("reactions"), number("daily_content_metrics.reactions").add("REACTION".equals(type) ? 1L : 0L))
                .set(time("updated_at"), now)
                .execute();
    }

    List<DailyMetricView> pageMetrics(UUID workspaceId, UUID pageId, LocalDate from, LocalDate to) {
        return metricQuery(uuid("workspace_id").eq(workspaceId)
                .and(string("resource_type").eq("PAGE"))
                .and(uuid("resource_id").eq(pageId))
                .and(date("metric_date").between(from, to)));
    }

    List<DailyMetricView> knowledgeBaseMetrics(UUID workspaceId, UUID knowledgeBaseId, LocalDate from, LocalDate to) {
        return dsl.select(
                        date("m.metric_date"),
                        sum("m.views"), sum("m.unique_views"), sum("m.edits"), sum("m.comments"),
                        sum("m.shares"), sum("m.exports"), sum("m.reactions"))
                .from(table(name("daily_content_metrics")).as("m"))
                .join(table(name("pages")).as("p"))
                .on(uuid("p.id").eq(uuid("m.resource_id")))
                .where(uuid("m.workspace_id").eq(workspaceId)
                        .and(string("m.resource_type").eq("PAGE"))
                        .and(uuid("p.knowledge_base_id").eq(knowledgeBaseId))
                        .and(date("m.metric_date").between(from, to)))
                .groupBy(date("m.metric_date"))
                .orderBy(date("m.metric_date"))
                .fetch(r -> metric(r.value1(), r.value2(), r.value3(), r.value4(), r.value5(), r.value6(), r.value7(), r.value8()));
    }

    private List<DailyMetricView> metricQuery(org.jooq.Condition condition) {
        return dsl.select(date("metric_date"), number("views"), number("unique_views"), number("edits"),
                        number("comments"), number("shares"), number("exports"), number("reactions"))
                .from(METRICS).where(condition).orderBy(date("metric_date"))
                .fetch(r -> metric(r.value1(), r.value2(), r.value3(), r.value4(), r.value5(), r.value6(), r.value7(), r.value8()));
    }

    private static DailyMetricView metric(LocalDate date, Number views, Number unique, Number edits, Number comments, Number shares, Number exports, Number reactions) {
        return new DailyMetricView(date, value(views), value(unique), value(edits), value(comments), value(shares), value(exports), value(reactions));
    }

    private static long value(Number value) { return value == null ? 0 : value.longValue(); }
    private static org.jooq.Field<UUID> uuid(String value) { return field(name(value.split("\\.")), UUID.class); }
    private static org.jooq.Field<String> string(String value) { return field(name(value.split("\\.")), String.class); }
    private static org.jooq.Field<Long> number(String value) { return field(name(value.split("\\.")), Long.class); }
    private static org.jooq.Field<LocalDate> date(String value) { return field(name(value.split("\\.")), LocalDate.class); }
    private static org.jooq.Field<OffsetDateTime> time(String value) { return field(name(value.split("\\.")), OffsetDateTime.class); }
    private static org.jooq.Field<JSONB> json(String value) { return field(name(value.split("\\.")), JSONB.class); }
    private static org.jooq.Field<java.math.BigDecimal> sum(String value) { return org.jooq.impl.DSL.sum(field(name(value.split("\\.")), Long.class)); }
}
