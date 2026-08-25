package io.knowledge.platform.page;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

record StoredPageReference(
        UUID id,
        UUID workspaceId,
        UUID sourcePageId,
        String sourceScope,
        long sourceRevision,
        UUID sourcePublicationId,
        UUID targetPageId,
        String targetBlockId,
        ReferenceKind kind,
        EmbedMode mode,
        UUID fixedPublicationId,
        String sourcePointer,
        JsonNode displaySettings,
        int ordinal,
        OffsetDateTime createdAt) {

    boolean embedsContent() {
        return mode == EmbedMode.LIVE || mode == EmbedMode.FIXED;
    }
}
