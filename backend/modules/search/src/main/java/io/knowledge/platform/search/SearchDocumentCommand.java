package io.knowledge.platform.search;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record SearchDocumentCommand(
        UUID id,
        UUID workspaceId,
        String resourceType,
        UUID resourceId,
        String sourceScope,
        String title,
        String body,
        List<String> labels,
        String path,
        UUID ownerId,
        String contentType,
        String visibility,
        UUID publicationId,
        long permissionVersion,
        JsonNode metadata,
        OffsetDateTime sourceCreatedAt,
        OffsetDateTime sourceUpdatedAt) {}
