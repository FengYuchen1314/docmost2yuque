package io.knowledge.platform.page;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import io.knowledge.platform.common.DomainConflictException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
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
class ContentCardRepository {

    private static final Table<Record> INSTANCES = table(name("page_card_instances"));
    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    ContentCardRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    void synchronize(
            PageView page,
            UUID actorId,
            List<ExtractedContentCard> cards,
            OffsetDateTime now) {
        for (ExtractedContentCard card : cards) {
            UUID ownerPageId = dsl.select(uuid("page_id"))
                    .from(INSTANCES)
                    .where(uuid("id").eq(card.instanceId()))
                    .fetchOne(uuid("page_id"));
            if (ownerPageId != null && !ownerPageId.equals(page.id())) {
                throw new DomainConflictException(
                        "CARD_INSTANCE_REUSED",
                        "A content card instance cannot be reused on another page");
            }
        }
        dsl.update(INSTANCES)
                .set(time("archived_at"), now)
                .set(uuid("updated_by"), actorId)
                .set(time("updated_at"), now)
                .where(uuid("page_id")
                        .eq(page.id())
                        .and(time("archived_at").isNull()))
                .execute();
        for (ExtractedContentCard card : cards) {
            dsl.insertInto(INSTANCES)
                    .columns(
                            uuid("id"),
                            uuid("workspace_id"),
                            uuid("page_id"),
                            string("card_id"),
                            integer("schema_version"),
                            json("data_json"),
                            string("source_pointer"),
                            number("page_revision_no"),
                            uuid("created_by"),
                            uuid("updated_by"),
                            time("created_at"),
                            time("updated_at"),
                            time("archived_at"))
                    .values(
                            card.instanceId(),
                            page.workspaceId(),
                            page.id(),
                            card.cardId(),
                            card.version(),
                            JSONB.valueOf(objectMapper.writeValueAsString(card.data())),
                            card.sourcePointer(),
                            page.draftRevision(),
                            actorId,
                            actorId,
                            now,
                            now,
                            null)
                    .onConflict(uuid("id"))
                    .doUpdate()
                    .set(string("card_id"), card.cardId())
                    .set(integer("schema_version"), card.version())
                    .set(json("data_json"),
                            JSONB.valueOf(objectMapper.writeValueAsString(card.data())))
                    .set(string("source_pointer"), card.sourcePointer())
                    .set(number("page_revision_no"), page.draftRevision())
                    .set(uuid("updated_by"), actorId)
                    .set(time("updated_at"), now)
                    .set(time("archived_at"), (OffsetDateTime) null)
                    .execute();
        }
    }

    ContentCardInstanceView findActive(UUID instanceId) {
        return selectInstances()
                .and(uuid("id")
                        .eq(instanceId)
                        .and(time("archived_at").isNull()))
                .fetchOne(this::mapInstance);
    }

    void recordUsage(UUID userId, String cardId, OffsetDateTime now) {
        dsl.insertInto(table(name("user_card_usage")))
                .columns(uuid("user_id"), string("card_id"), number("use_count"), time("last_used_at"))
                .values(userId, cardId, 1L, now)
                .onConflict(uuid("user_id"), string("card_id"))
                .doUpdate()
                .set(number("use_count"),
                        field(name("user_card_usage", "use_count"), Long.class)
                                .plus(1L))
                .set(time("last_used_at"), now)
                .execute();
    }

    List<String> recentCardIds(UUID userId, int limit) {
        return dsl.select(string("card_id"))
                .from(table(name("user_card_usage")))
                .where(uuid("user_id").eq(userId))
                .orderBy(time("last_used_at").desc(), number("use_count").desc())
                .limit(limit)
                .fetch(string("card_id"));
    }

    void upsertVote(
            UUID instanceId,
            UUID userId,
            List<String> optionIds,
            OffsetDateTime now) {
        JSONB options = JSONB.valueOf(objectMapper.writeValueAsString(optionIds));
        dsl.insertInto(table(name("card_poll_votes")))
                .columns(uuid("card_instance_id"), uuid("user_id"), json("option_ids"), time("created_at"), time("updated_at"))
                .values(instanceId, userId, options, now, now)
                .onConflict(uuid("card_instance_id"), uuid("user_id"))
                .doUpdate()
                .set(json("option_ids"), options)
                .set(time("updated_at"), now)
                .execute();
    }

    List<PollVote> pollVotes(UUID instanceId) {
        return dsl.select(uuid("user_id"), json("option_ids"))
                .from(table(name("card_poll_votes")))
                .where(uuid("card_instance_id").eq(instanceId))
                .fetch(record -> {
                    List<String> optionIds = new ArrayList<>();
                    JsonNode options = objectMapper.readTree(record.value2().data());
                    for (JsonNode option : options) {
                        optionIds.add(option.stringValue());
                    }
                    return new PollVote(record.value1(), List.copyOf(optionIds));
                });
    }

    void checkin(UUID instanceId, UUID userId, LocalDate localDate, OffsetDateTime now) {
        dsl.insertInto(table(name("card_checkins")))
                .columns(uuid("card_instance_id"), uuid("user_id"), date("local_date"), time("created_at"))
                .values(instanceId, userId, localDate, now)
                .onConflictDoNothing()
                .execute();
    }

    CheckinCounts checkinCounts(UUID instanceId, UUID userId, LocalDate localDate) {
        long participants = dsl.selectCount()
                .from(dsl.select(uuid("user_id"))
                        .from(table(name("card_checkins")))
                        .where(uuid("card_instance_id").eq(instanceId))
                        .groupBy(uuid("user_id")))
                .fetchOne(0, long.class);
        long today = dsl.fetchCount(
                table(name("card_checkins")),
                uuid("card_instance_id")
                        .eq(instanceId)
                        .and(date("local_date").eq(localDate)));
        boolean checked = dsl.fetchExists(dsl.selectOne()
                .from(table(name("card_checkins")))
                .where(uuid("card_instance_id")
                        .eq(instanceId)
                        .and(uuid("user_id").eq(userId))
                        .and(date("local_date").eq(localDate))));
        return new CheckinCounts(participants, today, checked);
    }

    private org.jooq.SelectConditionStep<? extends Record> selectInstances() {
        return dsl.select(
                        uuid("id"),
                        uuid("workspace_id"),
                        uuid("page_id"),
                        string("card_id"),
                        integer("schema_version"),
                        json("data_json"),
                        number("page_revision_no"),
                        uuid("created_by"),
                        uuid("updated_by"),
                        time("created_at"),
                        time("updated_at"),
                        time("archived_at"))
                .from(INSTANCES)
                .where(uuid("id").isNotNull());
    }

    private ContentCardInstanceView mapInstance(Record record) {
        return new ContentCardInstanceView(
                record.get(uuid("id")),
                record.get(uuid("workspace_id")),
                record.get(uuid("page_id")),
                record.get(string("card_id")),
                record.get(integer("schema_version")),
                objectMapper.readTree(record.get(json("data_json")).data()),
                record.get(number("page_revision_no")),
                record.get(uuid("created_by")),
                record.get(uuid("updated_by")),
                record.get(time("created_at")),
                record.get(time("updated_at")),
                record.get(time("archived_at")));
    }

    private static org.jooq.Field<UUID> uuid(String value) {
        return field(name(value), UUID.class);
    }

    private static org.jooq.Field<String> string(String value) {
        return field(name(value), String.class);
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

    private static org.jooq.Field<OffsetDateTime> time(String value) {
        return field(name(value), OffsetDateTime.class);
    }

    private static org.jooq.Field<LocalDate> date(String value) {
        return field(name(value), LocalDate.class);
    }

    record PollVote(UUID userId, List<String> optionIds) {}

    record CheckinCounts(long participants, long today, boolean checked) {}
}
