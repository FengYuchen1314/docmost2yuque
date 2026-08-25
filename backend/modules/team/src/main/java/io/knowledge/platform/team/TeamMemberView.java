package io.knowledge.platform.team;

import java.time.OffsetDateTime;
import java.util.UUID;

public record TeamMemberView(
        UUID userId,
        String email,
        String displayName,
        String role,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
