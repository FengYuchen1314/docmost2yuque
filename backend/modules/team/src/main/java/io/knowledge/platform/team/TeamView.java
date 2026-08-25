package io.knowledge.platform.team;

import java.time.OffsetDateTime;
import java.util.UUID;

public record TeamView(
        UUID id,
        UUID workspaceId,
        String name,
        String slug,
        String description,
        String avatar,
        String visibility,
        UUID createdBy,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
