package io.knowledge.platform.knowledgebase;

import java.time.OffsetDateTime;
import java.util.UUID;

public record KnowledgeBaseView(
        UUID id,
        UUID workspaceId,
        String name,
        String slug,
        String description,
        String icon,
        String ownerType,
        UUID ownerId,
        UUID teamId,
        UUID homepagePageId,
        String visibility,
        boolean allowPublicIndex,
        String publishMode,
        String watermarkConfig,
        String appearanceConfig,
        String catalogConfig,
        long catalogRevision,
        UUID createdBy,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
