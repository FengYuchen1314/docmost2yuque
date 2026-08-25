package io.knowledge.platform.share;

import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record KnowledgeBaseShareView(
        UUID id,
        String name,
        String slug,
        String description,
        String icon,
        UUID homepagePageId,
        long catalogRevision,
        JsonNode appearanceConfig,
        JsonNode watermarkConfig,
        JsonNode catalogConfig,
        List<KnowledgeBaseShareNodeView> catalog,
        List<KnowledgeBaseSharePageView> pages,
        UUID selectedPageId) {}
