package io.knowledge.platform.knowledgebase;

import java.util.UUID;

public record CreateKnowledgeBaseCommand(
        UUID workspaceId,
        String name,
        String slug,
        String description,
        String icon,
        String ownerType,
        UUID ownerId,
        String visibility,
        Boolean allowPublicIndex,
        String publishMode) {}
