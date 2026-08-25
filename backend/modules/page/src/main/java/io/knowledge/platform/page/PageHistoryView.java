package io.knowledge.platform.page;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record PageHistoryView(
        UUID id,
        UUID pageId,
        long revisionNo,
        String revisionKind,
        String description,
        String title,
        JsonNode content,
        String plainText,
        int schemaVersion,
        UUID createdBy,
        OffsetDateTime createdAt) {}
