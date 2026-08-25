package io.knowledge.platform.catalog;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record CatalogNodeView(
        UUID id,
        UUID workspaceId,
        UUID knowledgeBaseId,
        CatalogNodeType nodeType,
        UUID pageId,
        UUID parentId,
        String position,
        String titleOverride,
        String url,
        JsonNode metadata,
        UUID createdBy,
        UUID updatedBy,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
