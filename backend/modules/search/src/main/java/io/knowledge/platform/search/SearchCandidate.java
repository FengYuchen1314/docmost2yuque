package io.knowledge.platform.search;

import java.time.OffsetDateTime;
import java.util.UUID;

record SearchCandidate(
        UUID documentId,
        UUID workspaceId,
        String resourceType,
        UUID resourceId,
        String sourceScope,
        String title,
        String body,
        String path,
        UUID ownerId,
        String contentType,
        String visibility,
        UUID publicationId,
        UUID knowledgeBaseId,
        UUID parentPageId,
        String publicationStatus,
        double score,
        OffsetDateTime updatedAt) {}
