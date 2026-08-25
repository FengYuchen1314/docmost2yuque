package io.knowledge.platform.search;

import java.time.OffsetDateTime;
import java.util.UUID;

public record SearchResultView(
        UUID documentId,
        UUID resourceId,
        String resourceType,
        String sourceScope,
        String title,
        String snippet,
        String path,
        String contentType,
        UUID publicationId,
        UUID knowledgeBaseId,
        UUID ownerId,
        String publicationStatus,
        double score,
        OffsetDateTime updatedAt) {}
