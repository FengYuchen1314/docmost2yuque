package io.knowledge.platform.workspace;

import java.time.OffsetDateTime;
import java.util.UUID;

public record WorkspaceView(
        UUID id,
        String workspaceType,
        String name,
        String defaultVisibility,
        String defaultPublishMode,
        String membershipRole,
        UUID createdBy,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
