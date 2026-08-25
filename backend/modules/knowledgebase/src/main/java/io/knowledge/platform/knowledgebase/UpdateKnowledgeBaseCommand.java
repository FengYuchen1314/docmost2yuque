package io.knowledge.platform.knowledgebase;

import java.util.UUID;

public record UpdateKnowledgeBaseCommand(
        UUID knowledgeBaseId,
        String name,
        String slug,
        String description,
        String icon,
        String visibility,
        Boolean allowPublicIndex,
        String publishMode,
        String watermarkConfig,
        String appearanceConfig,
        String catalogConfig,
        UUID homepagePageId) {}
