package io.knowledge.platform.catalog;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record CatalogRevisionView(
        UUID id,
        UUID knowledgeBaseId,
        long revisionNo,
        String operation,
        JsonNode snapshot,
        UUID actorId,
        OffsetDateTime createdAt) {}
