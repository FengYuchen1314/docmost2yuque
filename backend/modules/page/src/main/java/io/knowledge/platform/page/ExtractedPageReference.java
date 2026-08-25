package io.knowledge.platform.page;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

record ExtractedPageReference(
        UUID targetPageId,
        String targetBlockId,
        ReferenceKind kind,
        EmbedMode mode,
        UUID fixedPublicationId,
        String sourcePointer,
        JsonNode displaySettings,
        int ordinal) {

    boolean embedsContent() {
        return mode == EmbedMode.LIVE || mode == EmbedMode.FIXED;
    }
}
