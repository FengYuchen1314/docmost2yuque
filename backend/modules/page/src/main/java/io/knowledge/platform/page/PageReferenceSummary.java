package io.knowledge.platform.page;

import java.time.OffsetDateTime;
import java.util.UUID;

public record PageReferenceSummary(
        UUID referenceId,
        String direction,
        String sourceScope,
        ReferenceKind kind,
        EmbedMode mode,
        String targetBlockId,
        UUID fixedPublicationId,
        boolean accessible,
        UUID pageId,
        UUID knowledgeBaseId,
        String title,
        ContentType contentType,
        String path,
        OffsetDateTime updatedAt) {}
