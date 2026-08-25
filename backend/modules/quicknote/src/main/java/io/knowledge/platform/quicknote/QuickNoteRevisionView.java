package io.knowledge.platform.quicknote;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record QuickNoteRevisionView(
        UUID id,
        UUID quickNoteId,
        long revision,
        String kind,
        JsonNode content,
        String plainText,
        OffsetDateTime createdAt) {}
