package io.knowledge.platform.catalog;

import java.util.List;
import java.util.UUID;

public record CatalogTreeView(
        UUID knowledgeBaseId,
        long revision,
        List<CatalogNodeView> nodes) {}
