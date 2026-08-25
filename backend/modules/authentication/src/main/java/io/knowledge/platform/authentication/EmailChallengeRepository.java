package io.knowledge.platform.authentication;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record10;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class EmailChallengeRepository {

    private static final Table<org.jooq.Record> CHALLENGES =
            table(name("email_auth_challenges"));
    private static final Field<UUID> ID = field(name("id"), UUID.class);
    private static final Field<String> EMAIL_NORMALIZED =
            field(name("email_normalized"), String.class);
    private static final Field<String> PURPOSE = field(name("purpose"), String.class);
    private static final Field<String> CODE_HASH = field(name("code_hash"), String.class);
    private static final Field<String> DELIVERY_SECRET_ENCRYPTED =
            field(name("delivery_secret_encrypted"), String.class);
    private static final Field<String> PENDING_PASSWORD_HASH =
            field(name("pending_password_hash"), String.class);
    private static final Field<OffsetDateTime> EXPIRES_AT =
            field(name("expires_at"), OffsetDateTime.class);
    private static final Field<OffsetDateTime> CONSUMED_AT =
            field(name("consumed_at"), OffsetDateTime.class);
    private static final Field<Integer> ATTEMPT_COUNT =
            field(name("attempt_count"), Integer.class);
    private static final Field<String> REQUESTED_IP_HASH =
            field(name("requested_ip_hash"), String.class);
    private static final Field<OffsetDateTime> CREATED_AT =
            field(name("created_at"), OffsetDateTime.class);

    private final DSLContext dsl;

    EmailChallengeRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    int countRecentByEmail(String emailNormalized, OffsetDateTime since) {
        return dsl.fetchCount(
                dsl.selectOne()
                        .from(CHALLENGES)
                        .where(EMAIL_NORMALIZED.eq(emailNormalized).and(CREATED_AT.ge(since))));
    }

    int countRecentByIp(String ipHash, OffsetDateTime since) {
        return dsl.fetchCount(
                dsl.selectOne()
                        .from(CHALLENGES)
                        .where(REQUESTED_IP_HASH.eq(ipHash).and(CREATED_AT.ge(since))));
    }

    void invalidatePrevious(String emailNormalized, String purpose, OffsetDateTime now) {
        dsl.update(CHALLENGES)
                .set(CONSUMED_AT, now)
                .set(DELIVERY_SECRET_ENCRYPTED, (String) null)
                .where(EMAIL_NORMALIZED.eq(emailNormalized)
                        .and(PURPOSE.eq(purpose))
                        .and(CONSUMED_AT.isNull()))
                .execute();
    }

    void insert(
            UUID challengeId,
            String emailNormalized,
            String purpose,
            String codeHash,
            String encryptedDeliverySecret,
            String pendingPasswordHash,
            OffsetDateTime expiresAt,
            String requestedIpHash,
            OffsetDateTime now) {
        dsl.insertInto(CHALLENGES)
                .columns(
                        ID,
                        EMAIL_NORMALIZED,
                        PURPOSE,
                        CODE_HASH,
                        DELIVERY_SECRET_ENCRYPTED,
                        PENDING_PASSWORD_HASH,
                        EXPIRES_AT,
                        ATTEMPT_COUNT,
                        REQUESTED_IP_HASH,
                        CREATED_AT)
                .values(
                        challengeId,
                        emailNormalized,
                        purpose,
                        codeHash,
                        encryptedDeliverySecret,
                        pendingPasswordHash,
                        expiresAt,
                        0,
                        requestedIpHash,
                        now)
                .execute();
    }

    EmailChallengeRecord findByIdForUpdate(UUID challengeId, String purpose) {
        return selectChallenge()
                .and(ID.eq(challengeId).and(PURPOSE.eq(purpose)))
                .forUpdate()
                .fetchOne(EmailChallengeRepository::map);
    }

    EmailChallengeRecord findLatestForUpdate(String emailNormalized, String purpose) {
        return selectChallenge()
                .and(EMAIL_NORMALIZED.eq(emailNormalized).and(PURPOSE.eq(purpose)))
                .orderBy(CREATED_AT.desc())
                .limit(1)
                .forUpdate()
                .fetchOne(EmailChallengeRepository::map);
    }

    EmailChallengeRecord findForDelivery(UUID challengeId) {
        return selectChallenge()
                .and(ID.eq(challengeId).and(CONSUMED_AT.isNull()))
                .fetchOne(EmailChallengeRepository::map);
    }

    void recordFailedAttempt(EmailChallengeRecord challenge, OffsetDateTime now) {
        int nextAttempt = challenge.attemptCount() + 1;
        dsl.update(CHALLENGES)
                .set(ATTEMPT_COUNT, nextAttempt)
                .set(CONSUMED_AT, nextAttempt >= 5 ? now : null)
                .set(
                        DELIVERY_SECRET_ENCRYPTED,
                        nextAttempt >= 5 ? null : challenge.encryptedDeliverySecret())
                .where(ID.eq(challenge.id()).and(CONSUMED_AT.isNull()))
                .execute();
    }

    void consume(UUID challengeId, OffsetDateTime now) {
        int updated = dsl.update(CHALLENGES)
                .set(CONSUMED_AT, now)
                .set(DELIVERY_SECRET_ENCRYPTED, (String) null)
                .set(PENDING_PASSWORD_HASH, (String) null)
                .where(ID.eq(challengeId).and(CONSUMED_AT.isNull()))
                .execute();
        if (updated != 1) {
            throw new EmailChallengeInvalidException();
        }
    }

    private org.jooq.SelectConditionStep<
                    Record10<
                            UUID,
                            String,
                            String,
                            String,
                            String,
                            String,
                            OffsetDateTime,
                            OffsetDateTime,
                            Integer,
                            OffsetDateTime>>
            selectChallenge() {
        return dsl.select(
                        ID,
                        EMAIL_NORMALIZED,
                        PURPOSE,
                        CODE_HASH,
                        DELIVERY_SECRET_ENCRYPTED,
                        PENDING_PASSWORD_HASH,
                        EXPIRES_AT,
                        CONSUMED_AT,
                        ATTEMPT_COUNT,
                        CREATED_AT)
                .from(CHALLENGES)
                .where(field("true", Boolean.class));
    }

    private static EmailChallengeRecord map(
            Record10<
                            UUID,
                            String,
                            String,
                            String,
                            String,
                            String,
                            OffsetDateTime,
                            OffsetDateTime,
                            Integer,
                            OffsetDateTime>
                    record) {
        return new EmailChallengeRecord(
                record.value1(),
                record.value2(),
                record.value3(),
                record.value4(),
                record.value5(),
                record.value6(),
                record.value7(),
                record.value8(),
                record.value9(),
                record.value10());
    }
}
