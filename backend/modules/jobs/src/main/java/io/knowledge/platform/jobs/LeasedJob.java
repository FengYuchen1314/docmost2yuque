package io.knowledge.platform.jobs;

import tools.jackson.databind.JsonNode;
import java.util.UUID;

public record LeasedJob(
        UUID id,
        String jobType,
        String idempotencyKey,
        JsonNode payload,
        int attemptCount,
        int maxAttempts) {}
