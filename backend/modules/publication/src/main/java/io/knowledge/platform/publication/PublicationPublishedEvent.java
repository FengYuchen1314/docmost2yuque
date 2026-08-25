package io.knowledge.platform.publication;

import java.time.OffsetDateTime;
import java.util.UUID;

public record PublicationPublishedEvent(
        UUID publicationId,
        UUID pageId,
        UUID workspaceId,
        UUID knowledgeBaseId,
        UUID publishedBy,
        String title,
        String preview,
        String contentType,
        String visibility,
        OffsetDateTime publishedAt) {}
