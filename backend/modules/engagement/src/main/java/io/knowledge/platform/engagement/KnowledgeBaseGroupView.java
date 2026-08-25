package io.knowledge.platform.engagement;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record KnowledgeBaseGroupView(
        UUID id,
        UUID workspaceId,
        String name,
        String position,
        List<KnowledgeBaseGroupItemView> items,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
