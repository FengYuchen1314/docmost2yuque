package io.knowledge.platform.page;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record PageView(
        UUID id,
        UUID workspaceId,
        UUID knowledgeBaseId,
        String title,
        String icon,
        String cover,
        ContentType contentType,
        String path,
        String publishMode,
        UUID publishedRevisionId,
        OffsetDateTime publishedAt,
        String visibilityOverride,
        JsonNode documentSettings,
        int schemaVersion,
        long draftRevision,
        JsonNode content,
        String plainText,
        UUID createdBy,
        UUID updatedBy,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        OffsetDateTime deletedAt) {}
