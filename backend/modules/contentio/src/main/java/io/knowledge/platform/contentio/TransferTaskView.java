package io.knowledge.platform.contentio;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record TransferTaskView(
        UUID id, UUID workspaceId, String taskType, String sourceFormat,
        String resourceType, UUID resourceId, String status, int progress,
        String originalFilename, String resultFilename, String resultMediaType,
        long artifactSize, JsonNode report, UUID requestedBy, OffsetDateTime createdAt,
        OffsetDateTime startedAt, OffsetDateTime completedAt, OffsetDateTime expiresAt,
        boolean cancelRequested) {}
