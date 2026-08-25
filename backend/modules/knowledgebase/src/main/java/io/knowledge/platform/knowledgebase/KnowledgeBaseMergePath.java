package io.knowledge.platform.knowledgebase;

import java.util.UUID;

public record KnowledgeBaseMergePath(
        UUID pageId,
        String title,
        String originalPath,
        String resolvedPath,
        boolean renamed) {}
