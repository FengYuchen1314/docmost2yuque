package io.knowledge.platform.share;

import java.util.UUID;

public record KnowledgeBaseShareNodeView(
        UUID id,
        String nodeType,
        UUID pageId,
        UUID parentId,
        String position,
        String title,
        String url) {}
