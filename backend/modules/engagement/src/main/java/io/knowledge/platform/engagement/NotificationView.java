package io.knowledge.platform.engagement;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record NotificationView(
        UUID id,
        UUID workspaceId,
        String type,
        UUID actorId,
        String resourceType,
        UUID resourceId,
        JsonNode anchor,
        JsonNode payload,
        int occurrenceCount,
        OffsetDateTime readAt,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
