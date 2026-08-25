package io.knowledge.platform.page;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record ContentCardInstanceView(
        UUID id,
        UUID workspaceId,
        UUID pageId,
        String cardId,
        int schemaVersion,
        JsonNode data,
        long pageRevision,
        UUID createdBy,
        UUID updatedBy,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        OffsetDateTime archivedAt) {}
