package io.knowledge.platform.page;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record EmbeddedPageView(
        UUID referenceId,
        String status,
        EmbedMode mode,
        UUID pageId,
        String title,
        ContentType contentType,
        JsonNode content,
        String plainText,
        String targetBlockId,
        UUID publicationId,
        OffsetDateTime snapshotAt) {

    static EmbeddedPageView unavailable(UUID referenceId, EmbedMode mode) {
        return new EmbeddedPageView(
                referenceId,
                "UNAVAILABLE",
                mode,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null);
    }
}
