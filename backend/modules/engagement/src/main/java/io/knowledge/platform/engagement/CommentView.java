package io.knowledge.platform.engagement;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record CommentView(
        UUID id,
        UUID workspaceId,
        UUID pageId,
        UUID parentId,
        JsonNode anchor,
        JsonNode body,
        String plainText,
        String status,
        UUID createdBy,
        String creatorEmail,
        UUID resolvedBy,
        OffsetDateTime resolvedAt,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
