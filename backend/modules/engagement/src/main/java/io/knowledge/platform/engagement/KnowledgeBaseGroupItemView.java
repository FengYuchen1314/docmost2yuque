package io.knowledge.platform.engagement;

import java.util.UUID;

public record KnowledgeBaseGroupItemView(
        UUID knowledgeBaseId,
        String name,
        String icon,
        String visibility,
        String ownerType,
        String position) {}
