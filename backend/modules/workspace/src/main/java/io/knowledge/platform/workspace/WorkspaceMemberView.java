package io.knowledge.platform.workspace;

import java.time.OffsetDateTime;
import java.util.UUID;

public record WorkspaceMemberView(
        UUID userId,
        String email,
        String displayName,
        String role,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
