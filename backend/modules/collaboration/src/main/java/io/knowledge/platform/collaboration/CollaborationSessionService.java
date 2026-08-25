package io.knowledge.platform.collaboration;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CollaborationSessionService {

    private static final Table<Record> SESSIONS = table(name("collaboration_sessions"));

    private final DSLContext dsl;
    private final Clock clock;

    public CollaborationSessionService(DSLContext dsl, Clock clock) {
        this.dsl = dsl;
        this.clock = clock;
    }

    @Transactional
    public UUID requireActive(UUID userId, String httpSessionId) {
        if (userId == null || httpSessionId == null || httpSessionId.isBlank()) {
            throw new IllegalArgumentException("Authenticated HTTP session is required");
        }
        String sessionHash = hash(httpSessionId);
        Record existing = dsl.select(
                        field(name("id"), UUID.class),
                        field(name("user_id"), UUID.class),
                        field(name("revoked_at"), OffsetDateTime.class))
                .from(SESSIONS)
                .where(field(name("http_session_hash"), String.class).eq(sessionHash))
                .forUpdate()
                .fetchOne();
        OffsetDateTime now = OffsetDateTime.now(clock);
        if (existing != null) {
            if (!userId.equals(existing.get(field(name("user_id"), UUID.class)))) {
                throw new IllegalStateException("HTTP session belongs to a different user");
            }
            if (existing.get(field(name("revoked_at"), OffsetDateTime.class)) != null) {
                throw new DomainConflictException(
                        "COLLABORATION_SESSION_REVOKED", "The login session has been revoked");
            }
            dsl.update(SESSIONS)
                    .set(field(name("last_issued_at"), OffsetDateTime.class), now)
                    .where(field(name("http_session_hash"), String.class).eq(sessionHash))
                    .execute();
            return existing.get(field(name("id"), UUID.class));
        }

        UUID id = Ids.next();
        dsl.insertInto(SESSIONS)
                .columns(
                        field(name("id")),
                        field(name("user_id")),
                        field(name("http_session_hash")),
                        field(name("last_issued_at")),
                        field(name("created_at")))
                .values(id, userId, sessionHash, now, now)
                .execute();
        return id;
    }

    @Transactional
    public void revoke(String httpSessionId) {
        if (httpSessionId == null || httpSessionId.isBlank()) {
            return;
        }
        dsl.update(SESSIONS)
                .set(
                        field(name("revoked_at"), OffsetDateTime.class),
                        OffsetDateTime.now(clock))
                .where(field(name("http_session_hash"), String.class)
                        .eq(hash(httpSessionId))
                        .and(field(name("revoked_at"), OffsetDateTime.class).isNull()))
                .execute();
    }

    @Transactional
    public void revokeAll(UUID userId) {
        if (userId == null) return;
        dsl.update(SESSIONS)
                .set(field(name("revoked_at"), OffsetDateTime.class), OffsetDateTime.now(clock))
                .where(field(name("user_id"), UUID.class).eq(userId)
                        .and(field(name("revoked_at"), OffsetDateTime.class).isNull()))
                .execute();
    }

    @Transactional
    public void revokeOthers(UUID userId, String currentHttpSessionId) {
        if (userId == null || currentHttpSessionId == null || currentHttpSessionId.isBlank()) return;
        dsl.update(SESSIONS)
                .set(field(name("revoked_at"), OffsetDateTime.class), OffsetDateTime.now(clock))
                .where(field(name("user_id"), UUID.class).eq(userId)
                        .and(field(name("http_session_hash"), String.class)
                                .ne(hash(currentHttpSessionId)))
                        .and(field(name("revoked_at"), OffsetDateTime.class).isNull()))
                .execute();
    }

    private static String hash(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }
}
