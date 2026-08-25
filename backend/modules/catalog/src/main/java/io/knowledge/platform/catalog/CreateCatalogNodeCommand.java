package io.knowledge.platform.catalog;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record CreateCatalogNodeCommand(
        UUID knowledgeBaseId,
        CatalogNodeType nodeType,
        UUID pageId,
        UUID parentId,
        UUID beforeNodeId,
        UUID afterNodeId,
        String titleOverride,
        String url,
        JsonNode metadata,
        long expectedRevision) {}
