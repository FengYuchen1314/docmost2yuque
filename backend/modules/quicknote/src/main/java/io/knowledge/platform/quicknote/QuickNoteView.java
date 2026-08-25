package io.knowledge.platform.quicknote;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record QuickNoteView(
        UUID id,
        UUID workspaceId,
        UUID userId,
        JsonNode content,
        String plainText,
        String status,
        String source,
        long revision,
        List<QuickNoteTagView> tags,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        OffsetDateTime archivedAt,
        OffsetDateTime deletedAt) {}
