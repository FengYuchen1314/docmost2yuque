package io.knowledge.platform.setup;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.jooq.JSONB;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

@Repository
class InstanceSettingsRepository {

    private static final long INITIALIZATION_LOCK_KEY = 4_879_331_007L;
    private static final short SINGLETON_ID = 1;
    private static final Table<org.jooq.Record> INSTANCE_SETTINGS =
            table(name("instance_settings"));
    private static final Field<Short> ID = field(name("id"), Short.class);
    private static final Field<Boolean> INITIALIZED =
            field(name("initialized"), Boolean.class);
    private static final Field<String> REGISTRATION_MODE =
            field(name("registration_mode"), String.class);
    private static final Field<OffsetDateTime> INITIALIZED_AT =
            field(name("initialized_at"), OffsetDateTime.class);
    private static final Field<UUID> INITIALIZED_BY =
            field(name("initialized_by"), UUID.class);
    private static final Field<OffsetDateTime> UPDATED_AT =
            field(name("updated_at"), OffsetDateTime.class);
    private static final Field<JSONB> AUTH_METHODS =
            field(name("auth_methods"), JSONB.class);
    private static final Field<Long> SETTINGS_VERSION =
            field(name("settings_version"), Long.class);

    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    InstanceSettingsRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    SetupStatus getStatus() {
        org.jooq.Record2<Boolean, String> record = dsl.select(INITIALIZED, REGISTRATION_MODE)
                .from(INSTANCE_SETTINGS)
                .where(ID.eq(SINGLETON_ID))
                .fetchOne();
        if (record == null) {
            throw new IllegalStateException("Instance settings singleton is missing");
        }
        return new SetupStatus(
                Boolean.TRUE.equals(record.value1()),
                record.value2());
    }

    InstanceAuthSettings getAuthSettings() {
        org.jooq.Record3<String, JSONB, Long> record = dsl.select(
                        REGISTRATION_MODE, AUTH_METHODS, SETTINGS_VERSION)
                .from(INSTANCE_SETTINGS)
                .where(ID.eq(SINGLETON_ID))
                .fetchSingle();
        JsonNode methods;
        try {
            methods = objectMapper.readTree(record.value2().data());
        } catch (JacksonException exception) {
            throw new IllegalStateException("Stored authentication methods are invalid", exception);
        }
        return new InstanceAuthSettings(
                record.value1(),
                methods.path("password").asBoolean(true),
                methods.path("emailCode").asBoolean(false),
                record.value3());
    }

    InstanceAuthSettings updateAuthSettings(
            String registrationMode,
            JsonNode authMethods,
            OffsetDateTime now) {
        dsl.update(INSTANCE_SETTINGS)
                .set(REGISTRATION_MODE, registrationMode)
                .set(AUTH_METHODS, JSONB.valueOf(authMethods.toString()))
                .set(SETTINGS_VERSION, SETTINGS_VERSION.plus(1L))
                .set(UPDATED_AT, now)
                .where(ID.eq(SINGLETON_ID).and(INITIALIZED.isTrue()))
                .execute();
        return getAuthSettings();
    }

    void lockInitialization() {
        dsl.fetch("select pg_advisory_xact_lock(?)", INITIALIZATION_LOCK_KEY);
        dsl.select(INITIALIZED)
                .from(INSTANCE_SETTINGS)
                .where(ID.eq(SINGLETON_ID))
                .forUpdate()
                .fetchOne();
    }

    void markInitialized(UUID userId, OffsetDateTime now) {
        int updated = dsl.update(INSTANCE_SETTINGS)
                .set(INITIALIZED, true)
                .set(INITIALIZED_AT, now)
                .set(INITIALIZED_BY, userId)
                .set(REGISTRATION_MODE, "CLOSED")
                .set(UPDATED_AT, now)
                .where(ID.eq(SINGLETON_ID).and(INITIALIZED.isFalse()))
                .execute();
        if (updated != 1) {
            throw new InstanceAlreadyInitializedException();
        }
    }
}
