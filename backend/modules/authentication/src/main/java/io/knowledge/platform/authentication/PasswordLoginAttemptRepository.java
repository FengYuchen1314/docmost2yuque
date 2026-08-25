package io.knowledge.platform.authentication;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class PasswordLoginAttemptRepository {

    private static final Table<org.jooq.Record> ATTEMPTS = table(name("password_login_attempts"));
    private static final Field<UUID> ID = field(name("id"), UUID.class);
    private static final Field<String> PRINCIPAL_HASH = field(name("principal_hash"), String.class);
    private static final Field<String> IP_HASH = field(name("ip_hash"), String.class);
    private static final Field<OffsetDateTime> ATTEMPTED_AT =
            field(name("attempted_at"), OffsetDateTime.class);

    private final DSLContext dsl;

    PasswordLoginAttemptRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    void lock(String principalHash, String ipHash) {
        dsl.fetch(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                "password-login-principal:" + principalHash);
        dsl.fetch(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                "password-login-ip:" + ipHash);
    }

    int countPrincipal(String principalHash, OffsetDateTime since) {
        return dsl.fetchCount(dsl.selectOne()
                .from(ATTEMPTS)
                .where(PRINCIPAL_HASH.eq(principalHash).and(ATTEMPTED_AT.ge(since))));
    }

    int countIp(String ipHash, OffsetDateTime since) {
        return dsl.fetchCount(dsl.selectOne()
                .from(ATTEMPTS)
                .where(IP_HASH.eq(ipHash).and(ATTEMPTED_AT.ge(since))));
    }

    void record(UUID id, String principalHash, String ipHash, OffsetDateTime now) {
        dsl.insertInto(ATTEMPTS)
                .columns(ID, PRINCIPAL_HASH, IP_HASH, ATTEMPTED_AT)
                .values(id, principalHash, ipHash, now)
                .execute();
    }

    void clearPrincipal(String principalHash) {
        dsl.deleteFrom(ATTEMPTS).where(PRINCIPAL_HASH.eq(principalHash)).execute();
    }

    void prune(OffsetDateTime before) {
        dsl.deleteFrom(ATTEMPTS).where(ATTEMPTED_AT.lt(before)).execute();
    }
}
