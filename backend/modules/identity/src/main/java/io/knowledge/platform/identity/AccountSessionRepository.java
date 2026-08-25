package io.knowledge.platform.identity;

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
class AccountSessionRepository {

    private static final Table<Record> SESSIONS = table(name("account_sessions"));

    private final DSLContext dsl;

    AccountSessionRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    AccountSessionRecord find(String sessionHash) {
        return dsl.select(
                        field(name("id"), UUID.class),
                        field(name("user_id"), UUID.class),
                        field(name("last_seen_at"), OffsetDateTime.class),
                        field(name("revoked_at"), OffsetDateTime.class))
                .from(SESSIONS)
                .where(field(name("session_hash"), String.class).eq(sessionHash))
                .fetchOne(record -> new AccountSessionRecord(
                        record.value1(), record.value2(), record.value3(), record.value4()));
    }

    void insert(
            UUID id,
            UUID userId,
            String sessionHash,
            String userAgent,
            String ipAddress,
            OffsetDateTime now) {
        dsl.insertInto(SESSIONS)
                .columns(
                        field(name("id")),
                        field(name("user_id")),
                        field(name("session_hash")),
                        field(name("user_agent")),
                        field(name("ip_address")),
                        field(name("last_seen_at")),
                        field(name("created_at")))
                .values(id, userId, sessionHash, userAgent, ipAddress, now, now)
                .onConflict(field(name("session_hash")))
                .doNothing()
                .execute();
    }

    void touch(String sessionHash, String userAgent, String ipAddress, OffsetDateTime now) {
        dsl.update(SESSIONS)
                .set(field(name("user_agent"), String.class), userAgent)
                .set(field(name("ip_address"), String.class), ipAddress)
                .set(field(name("last_seen_at"), OffsetDateTime.class), now)
                .where(field(name("session_hash"), String.class).eq(sessionHash)
                        .and(field(name("revoked_at"), OffsetDateTime.class).isNull()))
                .execute();
    }

    List<AccountSessionRow> listActive(UUID userId) {
        return dsl.select(
                        field(name("id"), UUID.class),
                        field(name("session_hash"), String.class),
                        field(name("user_agent"), String.class),
                        field(name("ip_address"), String.class),
                        field(name("last_seen_at"), OffsetDateTime.class),
                        field(name("created_at"), OffsetDateTime.class))
                .from(SESSIONS)
                .where(field(name("user_id"), UUID.class).eq(userId)
                        .and(field(name("revoked_at"), OffsetDateTime.class).isNull()))
                .orderBy(field(name("last_seen_at"), OffsetDateTime.class).desc())
                .fetch(record -> new AccountSessionRow(
                        record.value1(), record.value2(), record.value3(), record.value4(),
                        record.value5(), record.value6()));
    }

    boolean revoke(UUID userId, UUID sessionId, String reason, OffsetDateTime now) {
        return dsl.update(SESSIONS)
                        .set(field(name("revoked_at"), OffsetDateTime.class), now)
                        .set(field(name("revoke_reason"), String.class), reason)
                        .where(field(name("id"), UUID.class).eq(sessionId)
                                .and(field(name("user_id"), UUID.class).eq(userId))
                                .and(field(name("revoked_at"), OffsetDateTime.class).isNull()))
                        .execute()
                == 1;
    }

    void revokeOthers(
            UUID userId, String currentSessionHash, String reason, OffsetDateTime now) {
        dsl.update(SESSIONS)
                .set(field(name("revoked_at"), OffsetDateTime.class), now)
                .set(field(name("revoke_reason"), String.class), reason)
                .where(field(name("user_id"), UUID.class).eq(userId)
                        .and(field(name("session_hash"), String.class).ne(currentSessionHash))
                        .and(field(name("revoked_at"), OffsetDateTime.class).isNull()))
                .execute();
    }

    void revokeAll(UUID userId, String reason, OffsetDateTime now) {
        dsl.update(SESSIONS)
                .set(field(name("revoked_at"), OffsetDateTime.class), now)
                .set(field(name("revoke_reason"), String.class), reason)
                .where(field(name("user_id"), UUID.class).eq(userId)
                        .and(field(name("revoked_at"), OffsetDateTime.class).isNull()))
                .execute();
    }

    void revokeHttpSession(String sessionHash, String reason, OffsetDateTime now) {
        dsl.update(SESSIONS)
                .set(field(name("revoked_at"), OffsetDateTime.class), now)
                .set(field(name("revoke_reason"), String.class), reason)
                .where(field(name("session_hash"), String.class).eq(sessionHash)
                        .and(field(name("revoked_at"), OffsetDateTime.class).isNull()))
                .execute();
    }

    record AccountSessionRecord(
            UUID id, UUID userId, OffsetDateTime lastSeenAt, OffsetDateTime revokedAt) {}

    record AccountSessionRow(
            UUID id,
            String sessionHash,
            String userAgent,
            String ipAddress,
            OffsetDateTime lastSeenAt,
            OffsetDateTime createdAt) {}
}
