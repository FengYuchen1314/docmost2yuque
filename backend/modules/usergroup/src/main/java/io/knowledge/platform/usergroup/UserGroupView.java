package io.knowledge.platform.usergroup;

import java.time.OffsetDateTime;
import java.util.UUID;

public record UserGroupView(
        UUID id,
        UUID workspaceId,
        String name,
        String description,
        int memberCount,
        UUID createdBy,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
