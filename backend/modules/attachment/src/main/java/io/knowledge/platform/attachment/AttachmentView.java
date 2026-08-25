package io.knowledge.platform.attachment;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AttachmentView(
        UUID id,
        UUID workspaceId,
        UUID pageId,
        String originalName,
        String mediaType,
        long sizeBytes,
        String checksumSha256,
        UUID uploadedBy,
        String extractionStatus,
        OffsetDateTime extractedAt,
        OffsetDateTime createdAt,
        String contentUrl) {}
