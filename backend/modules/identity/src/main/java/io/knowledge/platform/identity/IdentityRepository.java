package io.knowledge.platform.identity;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.List;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class IdentityRepository {

    private static final Table<org.jooq.Record> USERS = table(name("users"));
    private static final Table<org.jooq.Record> INSTANCE_ROLES =
            table(name("instance_roles"));
    private static final Field<UUID> ID = field(name("id"), UUID.class);
    private static final Field<String> EMAIL_ORIGINAL =
            field(name("email_original"), String.class);
    private static final Field<String> EMAIL_NORMALIZED =
            field(name("email_normalized"), String.class);
    private static final Field<String> PASSWORD_HASH =
            field(name("password_hash"), String.class);
    private static final Field<String> DISPLAY_NAME =
            field(name("display_name"), String.class);
    private static final Field<String> STATUS = field(name("status"), String.class);
    private static final Field<OffsetDateTime> EMAIL_VERIFIED_AT =
            field(name("email_verified_at"), OffsetDateTime.class);
    private static final Field<String> EMAIL_VERIFICATION_SOURCE =
            field(name("email_verification_source"), String.class);
    private static final Field<OffsetDateTime> CREATED_AT =
            field(name("created_at"), OffsetDateTime.class);
    private static final Field<OffsetDateTime> UPDATED_AT =
            field(name("updated_at"), OffsetDateTime.class);

    private final DSLContext dsl;

    IdentityRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    void insertBootstrapAdmin(
            UUID userId,
            String emailOriginal,
            String emailNormalized,
            String passwordHash,
            OffsetDateTime now) {
        dsl.insertInto(USERS)
                .columns(
                        ID,
                        EMAIL_ORIGINAL,
                        EMAIL_NORMALIZED,
                        PASSWORD_HASH,
                        STATUS,
                        EMAIL_VERIFIED_AT,
                        EMAIL_VERIFICATION_SOURCE,
                        CREATED_AT,
                        UPDATED_AT)
                .values(
                        userId,
                        emailOriginal,
                        emailNormalized,
                        passwordHash,
                        "ACTIVE",
                        now,
                        "BOOTSTRAP",
                        now,
                        now)
                .execute();

        dsl.insertInto(INSTANCE_ROLES)
                .columns(
                        field(name("user_id"), UUID.class),
                        field(name("role"), String.class),
                        field(name("granted_at"), OffsetDateTime.class),
                        field(name("granted_by"), UUID.class))
                .values(userId, "OWNER", now, userId)
                .execute();
    }

    void insertInvitedUser(
            UUID userId,
            String emailOriginal,
            String emailNormalized,
            String passwordHash,
            OffsetDateTime now) {
        dsl.insertInto(USERS)
                .columns(
                        ID,
                        EMAIL_ORIGINAL,
                        EMAIL_NORMALIZED,
                        PASSWORD_HASH,
                        STATUS,
                        EMAIL_VERIFIED_AT,
                        EMAIL_VERIFICATION_SOURCE,
                        CREATED_AT,
                        UPDATED_AT)
                .values(
                        userId,
                        emailOriginal,
                        emailNormalized,
                        passwordHash,
                        "ACTIVE",
                        now,
                        "INVITATION",
                        now,
                        now)
                .execute();
    }

    void insertPublicSignupUser(
            UUID userId,
            String emailOriginal,
            String emailNormalized,
            String passwordHash,
            OffsetDateTime now) {
        dsl.insertInto(USERS)
                .columns(
                        ID,
                        EMAIL_ORIGINAL,
                        EMAIL_NORMALIZED,
                        PASSWORD_HASH,
                        STATUS,
                        EMAIL_VERIFIED_AT,
                        EMAIL_VERIFICATION_SOURCE,
                        CREATED_AT,
                        UPDATED_AT)
                .values(
                        userId,
                        emailOriginal,
                        emailNormalized,
                        passwordHash,
                        "ACTIVE",
                        now,
                        "PUBLIC_SIGNUP",
                        now,
                        now)
                .execute();
    }

    void lockEmail(String emailNormalized) {
        dsl.fetch(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                emailNormalized);
    }

    IdentityRecord findActiveByEmail(String emailNormalized) {
        org.jooq.Record4<UUID, String, String, Boolean> record = dsl.select(
                        ID,
                        EMAIL_NORMALIZED,
                        PASSWORD_HASH,
                        field(
                                "exists (select 1 from instance_roles ir where ir.user_id = users.id)",
                                Boolean.class))
                .from(USERS)
                .where(EMAIL_NORMALIZED.eq(emailNormalized).and(STATUS.eq("ACTIVE")))
                .fetchOne();
        if (record == null) {
            return null;
        }
        return new IdentityRecord(
                record.get(ID),
                record.get(EMAIL_NORMALIZED),
                record.get(PASSWORD_HASH),
                Boolean.TRUE.equals(record.value4()));
    }

    IdentityRecord findActiveById(UUID userId) {
        org.jooq.Record4<UUID, String, String, Boolean> record = dsl.select(
                        ID,
                        EMAIL_NORMALIZED,
                        PASSWORD_HASH,
                        field(
                                "exists (select 1 from instance_roles ir where ir.user_id = users.id)",
                                Boolean.class))
                .from(USERS)
                .where(ID.eq(userId).and(STATUS.eq("ACTIVE")))
                .fetchOne();
        if (record == null) return null;
        return new IdentityRecord(
                record.get(ID), record.get(EMAIL_NORMALIZED), record.get(PASSWORD_HASH),
                Boolean.TRUE.equals(record.value4()));
    }

    boolean emailExists(String emailNormalized) {
        return dsl.fetchExists(
                dsl.selectOne()
                        .from(USERS)
                        .where(EMAIL_NORMALIZED.eq(emailNormalized)));
    }

    boolean updatePasswordForActiveEmail(
            String emailNormalized, String passwordHash, OffsetDateTime now) {
        return dsl.update(USERS)
                        .set(PASSWORD_HASH, passwordHash)
                        .set(UPDATED_AT, now)
                        .where(EMAIL_NORMALIZED.eq(emailNormalized).and(STATUS.eq("ACTIVE")))
                        .execute()
                == 1;
    }

    boolean updatePasswordForActiveUser(
            UUID userId, String passwordHash, OffsetDateTime now) {
        return dsl.update(USERS)
                        .set(PASSWORD_HASH, passwordHash)
                        .set(UPDATED_AT, now)
                        .where(ID.eq(userId).and(STATUS.eq("ACTIVE")))
                        .execute()
                == 1;
    }

    AccountView account(UUID userId) {
        return dsl.select(
                        ID, EMAIL_NORMALIZED, DISPLAY_NAME, STATUS, EMAIL_VERIFIED_AT,
                        EMAIL_VERIFICATION_SOURCE, CREATED_AT, UPDATED_AT)
                .from(USERS)
                .where(ID.eq(userId))
                .fetchOne(record -> new AccountView(
                        record.value1(), record.value2(), record.value3(), record.value4(),
                        record.value5(), record.value6(), record.value7(), record.value8()));
    }

    boolean updateDisplayName(UUID userId, String displayName, OffsetDateTime now) {
        return dsl.update(USERS)
                        .set(DISPLAY_NAME, displayName)
                        .set(UPDATED_AT, now)
                        .where(ID.eq(userId).and(STATUS.eq("ACTIVE")))
                        .execute()
                == 1;
    }

    List<InstanceUserView> listInstanceUsers(
            String query, String status, int limit, int offset) {
        Condition condition = org.jooq.impl.DSL.trueCondition();
        if (query != null) {
            condition = condition.and(EMAIL_NORMALIZED.containsIgnoreCase(query)
                    .or(DISPLAY_NAME.containsIgnoreCase(query)));
        }
        if (status != null) condition = condition.and(STATUS.eq(status));
        return instanceUserSelect()
                .where(condition)
                .orderBy(CREATED_AT.desc(), ID.desc())
                .limit(limit)
                .offset(Math.max(0, offset))
                .fetch(record -> toInstanceUser(record));
    }

    InstanceUserView instanceUser(UUID userId) {
        return instanceUserSelect()
                .where(ID.eq(userId))
                .fetchOne(record -> toInstanceUser(record));
    }

    AdministeredUser administeredUserForUpdate(UUID userId) {
        return dsl.select(
                        ID,
                        STATUS,
                        field("coalesce((select min(ir.role) from instance_roles ir "
                                + "where ir.user_id = users.id), 'USER')", String.class))
                .from(USERS)
                .where(ID.eq(userId))
                .forUpdate()
                .fetchOne(record -> new AdministeredUser(
                        record.value1(), record.value2(), record.value3()));
    }

    void updateUserStatus(UUID userId, String status, OffsetDateTime now) {
        dsl.update(USERS)
                .set(STATUS, status)
                .set(UPDATED_AT, now)
                .where(ID.eq(userId))
                .execute();
    }

    void grantInstanceAdministrator(UUID userId, UUID actorId, OffsetDateTime now) {
        dsl.insertInto(INSTANCE_ROLES)
                .columns(
                        field(name("user_id")),
                        field(name("role")),
                        field(name("granted_at")),
                        field(name("granted_by")))
                .values(userId, "ADMIN", now, actorId)
                .onConflict(field(name("user_id")), field(name("role")))
                .doNothing()
                .execute();
    }

    void revokeInstanceAdministrator(UUID userId) {
        dsl.deleteFrom(INSTANCE_ROLES)
                .where(field(name("user_id"), UUID.class).eq(userId)
                        .and(field(name("role"), String.class).eq("ADMIN")))
                .execute();
    }

    private org.jooq.SelectJoinStep<org.jooq.Record9<
            UUID, String, String, String, OffsetDateTime, String, Long,
            OffsetDateTime, OffsetDateTime>> instanceUserSelect() {
        return dsl.select(
                        ID,
                        EMAIL_NORMALIZED,
                        DISPLAY_NAME,
                        STATUS,
                        EMAIL_VERIFIED_AT,
                        field("coalesce((select min(ir.role) from instance_roles ir "
                                + "where ir.user_id = users.id), 'USER')", String.class),
                        field("(select count(*) from workspace_memberships wm "
                                + "where wm.user_id = users.id)", Long.class),
                        field("(select max(s.last_seen_at) from account_sessions s "
                                + "where s.user_id = users.id)", OffsetDateTime.class),
                        CREATED_AT)
                .from(USERS);
    }

    private static InstanceUserView toInstanceUser(org.jooq.Record9<
            UUID, String, String, String, OffsetDateTime, String, Long,
            OffsetDateTime, OffsetDateTime> record) {
        return new InstanceUserView(
                record.value1(), record.value2(), record.value3(), record.value4(),
                record.value5(), record.value6(), record.value7(), record.value8(),
                record.value9());
    }

    record AdministeredUser(UUID userId, String status, String instanceRole) {}
}
