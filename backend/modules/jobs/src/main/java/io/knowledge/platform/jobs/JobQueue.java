package io.knowledge.platform.jobs;

import tools.jackson.databind.JsonNode;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

public interface JobQueue {

    UUID enqueue(
            String jobType,
            String idempotencyKey,
            JsonNode payload,
            OffsetDateTime availableAt,
            int maxAttempts);

    Optional<LeasedJob> leaseNext(String workerId, OffsetDateTime now);

    void markSucceeded(UUID jobId, String workerId, OffsetDateTime finishedAt);

    void markFailed(
            UUID jobId,
            String workerId,
            String error,
            OffsetDateTime retryAt,
            OffsetDateTime finishedAt);
}
