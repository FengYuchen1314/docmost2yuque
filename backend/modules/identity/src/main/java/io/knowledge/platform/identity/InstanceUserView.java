package io.knowledge.platform.identity;

import java.time.OffsetDateTime;
import java.util.UUID;

public record InstanceUserView(
        UUID userId,
        String email,
        String displayName,
        String status,
        OffsetDateTime emailVerifiedAt,
        String instanceRole,
        long workspaceCount,
        OffsetDateTime lastSeenAt,
        OffsetDateTime createdAt) {}
