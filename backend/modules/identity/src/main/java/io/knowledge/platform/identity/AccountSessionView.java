package io.knowledge.platform.identity;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AccountSessionView(
        UUID id,
        boolean current,
        String userAgent,
        String ipAddress,
        OffsetDateTime lastSeenAt,
        OffsetDateTime createdAt) {}
