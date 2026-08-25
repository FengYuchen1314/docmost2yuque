package io.knowledge.platform.jobs;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import io.knowledge.platform.common.Ids;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
class DurableJobQueue implements JobQueue {

    private static final Table<Record> JOBS = table(name("durable_jobs"));
    private static final Field<UUID> ID = field(name("id"), UUID.class);
    private static final Field<String> JOB_TYPE = field(name("job_type"), String.class);
    private static final Field<String> IDEMPOTENCY_KEY =
            field(name("idempotency_key"), String.class);
    private static final Field<JSONB> PAYLOAD = field(name("payload"), JSONB.class);
    private static final Field<String> STATUS = field(name("status"), String.class);
    private static final Field<OffsetDateTime> AVAILABLE_AT =
            field(name("available_at"), OffsetDateTime.class);
    private static final Field<OffsetDateTime> LOCKED_AT =
            field(name("locked_at"), OffsetDateTime.class);
    private static final Field<String> LOCKED_BY = field(name("locked_by"), String.class);
    private static final Field<Integer> ATTEMPT_COUNT =
            field(name("attempt_count"), Integer.class);
    private static final Field<Integer> MAX_ATTEMPTS =
            field(name("max_attempts"), Integer.class);
    private static final Field<String> LAST_ERROR = field(name("last_error"), String.class);
    private static final Field<OffsetDateTime> CREATED_AT =
            field(name("created_at"), OffsetDateTime.class);
    private static final Field<OffsetDateTime> FINISHED_AT =
            field(name("finished_at"), OffsetDateTime.class);

    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    DurableJobQueue(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public UUID enqueue(
            String jobType,
            String idempotencyKey,
            JsonNode payload,
            OffsetDateTime availableAt,
            int maxAttempts) {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be positive");
        }
        UUID jobId = Ids.next();
        dsl.insertInto(JOBS)
                .columns(
                        ID,
                        JOB_TYPE,
                        IDEMPOTENCY_KEY,
                        PAYLOAD,
                        STATUS,
                        AVAILABLE_AT,
                        ATTEMPT_COUNT,
                        MAX_ATTEMPTS,
                        CREATED_AT)
                .values(
                        jobId,
                        requireText(jobType, "jobType"),
                        requireText(idempotencyKey, "idempotencyKey"),
                        JSONB.valueOf(payload.toString()),
                        "PENDING",
                        availableAt,
                        0,
                        maxAttempts,
                        OffsetDateTime.now())
                .onConflict(IDEMPOTENCY_KEY)
                .doNothing()
                .execute();
        return dsl.select(ID)
                .from(JOBS)
                .where(IDEMPOTENCY_KEY.eq(idempotencyKey))
                .fetchSingle(ID);
    }

    @Override
    @Transactional
    public Optional<LeasedJob> leaseNext(String workerId, OffsetDateTime now) {
        Record record = dsl.select(ID, JOB_TYPE, IDEMPOTENCY_KEY, PAYLOAD, ATTEMPT_COUNT, MAX_ATTEMPTS)
                .from(JOBS)
                .where(STATUS.eq("PENDING").and(AVAILABLE_AT.le(now)))
                .orderBy(AVAILABLE_AT.asc(), ID.asc())
                .limit(1)
                .forUpdate()
                .skipLocked()
                .fetchOne();
        if (record == null) {
            return Optional.empty();
        }

        UUID jobId = record.get(ID);
        int attempt = record.get(ATTEMPT_COUNT) + 1;
        dsl.update(JOBS)
                .set(STATUS, "RUNNING")
                .set(LOCKED_AT, now)
                .set(LOCKED_BY, workerId)
                .set(ATTEMPT_COUNT, attempt)
                .where(ID.eq(jobId))
                .execute();

        return Optional.of(new LeasedJob(
                jobId,
                record.get(JOB_TYPE),
                record.get(IDEMPOTENCY_KEY),
                readPayload(record.get(PAYLOAD)),
                attempt,
                record.get(MAX_ATTEMPTS)));
    }

    @Override
    @Transactional
    public void markSucceeded(UUID jobId, String workerId, OffsetDateTime finishedAt) {
        int updated = dsl.update(JOBS)
                .set(STATUS, "SUCCEEDED")
                .set(FINISHED_AT, finishedAt)
                .set(LOCKED_AT, (OffsetDateTime) null)
                .set(LOCKED_BY, (String) null)
                .where(ID.eq(jobId).and(STATUS.eq("RUNNING")).and(LOCKED_BY.eq(workerId)))
                .execute();
        requireLease(updated);
    }

    @Override
    @Transactional
    public void markFailed(
            UUID jobId,
            String workerId,
            String error,
            OffsetDateTime retryAt,
            OffsetDateTime finishedAt) {
        Integer attempts = dsl.select(ATTEMPT_COUNT)
                .from(JOBS)
                .where(ID.eq(jobId).and(STATUS.eq("RUNNING")).and(LOCKED_BY.eq(workerId)))
                .fetchOne(ATTEMPT_COUNT);
        Integer maximum = dsl.select(MAX_ATTEMPTS)
                .from(JOBS)
                .where(ID.eq(jobId).and(STATUS.eq("RUNNING")).and(LOCKED_BY.eq(workerId)))
                .fetchOne(MAX_ATTEMPTS);
        if (attempts == null || maximum == null) {
            throw new IllegalStateException("The durable job lease is no longer owned by this worker");
        }
        boolean terminal = attempts >= maximum;
        dsl.update(JOBS)
                .set(STATUS, terminal ? "FAILED" : "PENDING")
                .set(AVAILABLE_AT, retryAt)
                .set(LAST_ERROR, abbreviate(error, 8_000))
                .set(FINISHED_AT, terminal ? finishedAt : null)
                .set(LOCKED_AT, (OffsetDateTime) null)
                .set(LOCKED_BY, (String) null)
                .where(ID.eq(jobId).and(STATUS.eq("RUNNING")).and(LOCKED_BY.eq(workerId)))
                .execute();
    }

    private JsonNode readPayload(JSONB value) {
        try {
            return objectMapper.readTree(value.data());
        } catch (JacksonException exception) {
            throw new IllegalStateException("Stored durable job payload is invalid JSON", exception);
        }
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " is required");
        }
        return value;
    }

    private static String abbreviate(String value, int maximumLength) {
        if (value == null) {
            return "Unknown job failure";
        }
        return value.length() <= maximumLength ? value : value.substring(0, maximumLength);
    }

    private static void requireLease(int updated) {
        if (updated != 1) {
            throw new IllegalStateException("The durable job lease is no longer owned by this worker");
        }
    }
}
