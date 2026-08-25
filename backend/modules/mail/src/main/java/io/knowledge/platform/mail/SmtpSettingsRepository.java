package io.knowledge.platform.mail;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record13;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class SmtpSettingsRepository {

    private static final short SINGLETON_ID = 1;
    private static final Table<org.jooq.Record> SETTINGS = table(name("smtp_settings"));
    private static final Field<Short> ID = field(name("id"), Short.class);
    private static final Field<String> HOST = field(name("host"), String.class);
    private static final Field<Integer> PORT = field(name("port"), Integer.class);
    private static final Field<String> SECURITY = field(name("security"), String.class);
    private static final Field<String> USERNAME = field(name("username"), String.class);
    private static final Field<String> PASSWORD_ENCRYPTED =
            field(name("password_encrypted"), String.class);
    private static final Field<String> FROM_NAME = field(name("from_name"), String.class);
    private static final Field<String> FROM_ADDRESS = field(name("from_address"), String.class);
    private static final Field<String> REPLY_TO = field(name("reply_to"), String.class);
    private static final Field<Boolean> ENABLED = field(name("enabled"), Boolean.class);
    private static final Field<Long> CONFIGURATION_VERSION =
            field(name("configuration_version"), Long.class);
    private static final Field<OffsetDateTime> TESTED_AT =
            field(name("tested_at"), OffsetDateTime.class);
    private static final Field<String> TEST_STATUS = field(name("test_status"), String.class);
    private static final Field<String> LAST_ERROR_CODE =
            field(name("last_error_code"), String.class);
    private static final Field<UUID> UPDATED_BY = field(name("updated_by"), UUID.class);
    private static final Field<OffsetDateTime> UPDATED_AT =
            field(name("updated_at"), OffsetDateTime.class);

    private final DSLContext dsl;

    SmtpSettingsRepository(DSLContext dsl) {
        this.dsl = dsl;
    }

    SmtpSettingsRecord load() {
        Record13<
                        String,
                        Integer,
                        String,
                        String,
                        String,
                        String,
                        String,
                        String,
                        Boolean,
                        Long,
                        OffsetDateTime,
                        String,
                        String>
                record = dsl.select(
                                HOST,
                                PORT,
                                SECURITY,
                                USERNAME,
                                PASSWORD_ENCRYPTED,
                                FROM_NAME,
                                FROM_ADDRESS,
                                REPLY_TO,
                                ENABLED,
                                CONFIGURATION_VERSION,
                                TESTED_AT,
                                TEST_STATUS,
                                LAST_ERROR_CODE)
                        .from(SETTINGS)
                        .where(ID.eq(SINGLETON_ID))
                        .fetchSingle();
        return new SmtpSettingsRecord(
                record.value1(),
                record.value2(),
                record.value3(),
                record.value4(),
                record.value5(),
                record.value6(),
                record.value7(),
                record.value8(),
                Boolean.TRUE.equals(record.value9()),
                record.value10(),
                record.value11(),
                record.value12(),
                record.value13());
    }

    void update(
            SmtpSettingsRecord value,
            UUID updatedBy,
            OffsetDateTime updatedAt) {
        dsl.update(SETTINGS)
                .set(HOST, value.host())
                .set(PORT, value.port())
                .set(SECURITY, value.security())
                .set(USERNAME, value.username())
                .set(PASSWORD_ENCRYPTED, value.encryptedPassword())
                .set(FROM_NAME, value.fromName())
                .set(FROM_ADDRESS, value.fromAddress())
                .set(REPLY_TO, value.replyTo())
                .set(ENABLED, value.enabled())
                .set(CONFIGURATION_VERSION, value.configurationVersion())
                .set(TESTED_AT, value.testedAt())
                .set(TEST_STATUS, value.testStatus())
                .set(LAST_ERROR_CODE, value.lastErrorCode())
                .set(UPDATED_BY, updatedBy)
                .set(UPDATED_AT, updatedAt)
                .where(ID.eq(SINGLETON_ID))
                .execute();
    }

    void markTesting(long version, UUID updatedBy, OffsetDateTime now) {
        int updated = dsl.update(SETTINGS)
                .set(TEST_STATUS, "TESTING")
                .set(TESTED_AT, (OffsetDateTime) null)
                .set(LAST_ERROR_CODE, (String) null)
                .set(UPDATED_BY, updatedBy)
                .set(UPDATED_AT, now)
                .where(ID.eq(SINGLETON_ID).and(CONFIGURATION_VERSION.eq(version)))
                .execute();
        requireVersion(updated);
    }

    void markTestResult(
            long version,
            boolean success,
            String errorCode,
            OffsetDateTime now) {
        int updated = dsl.update(SETTINGS)
                .set(TEST_STATUS, success ? "SUCCESS" : "FAILED")
                .set(TESTED_AT, now)
                .set(LAST_ERROR_CODE, errorCode)
                .set(UPDATED_AT, now)
                .where(ID.eq(SINGLETON_ID).and(CONFIGURATION_VERSION.eq(version)))
                .execute();
        requireVersion(updated);
    }

    private static void requireVersion(int updated) {
        if (updated != 1) {
            throw new IllegalStateException("SMTP settings changed while the operation was running");
        }
    }
}
