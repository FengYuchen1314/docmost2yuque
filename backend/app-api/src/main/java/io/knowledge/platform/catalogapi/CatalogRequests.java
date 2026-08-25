package io.knowledge.platform.catalogapi;

import io.knowledge.platform.catalog.CatalogNodeType;
import java.util.UUID;
import java.util.List;
import tools.jackson.databind.JsonNode;

final class CatalogRequests {

    private CatalogRequests() {}

    record ListTree(UUID knowledgeBaseId) {}

    record Create(
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

    record Rename(UUID nodeId, String title, long expectedRevision) {}

    record Move(
            UUID nodeId,
            UUID targetParentId,
            UUID beforeNodeId,
            UUID afterNodeId,
            long expectedRevision) {}

    record Remove(UUID nodeId, long expectedRevision) {}

    record Batch(
            UUID knowledgeBaseId,
            List<UUID> nodeIds,
            String operation,
            UUID targetParentId,
            long expectedRevision) {}

    record History(UUID knowledgeBaseId, Integer limit, Integer offset) {}

    record Restore(UUID knowledgeBaseId, long revisionNo, long expectedRevision) {}
}
