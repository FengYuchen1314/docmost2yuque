package io.knowledge.platform.publication;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record PagePublicationView(
        UUID id,
        UUID workspaceId,
        UUID knowledgeBaseId,
        UUID pageId,
        long sourceDraftRevision,
        String contentType,
        String title,
        JsonNode content,
        String plainText,
        JsonNode metadata,
        int schemaVersion,
        UUID publishedBy,
        OffsetDateTime publishedAt,
        OffsetDateTime supersededAt) {}
