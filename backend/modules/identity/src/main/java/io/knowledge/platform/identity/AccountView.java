package io.knowledge.platform.identity;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AccountView(
        UUID userId,
        String email,
        String displayName,
        String status,
        OffsetDateTime emailVerifiedAt,
        String emailVerificationSource,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
