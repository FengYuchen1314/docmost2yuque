package io.knowledge.platform.share;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record QuickNoteShareView(
        UUID id,
        long sourceRevision,
        JsonNode content,
        String plainText,
        OffsetDateTime capturedAt) {}
