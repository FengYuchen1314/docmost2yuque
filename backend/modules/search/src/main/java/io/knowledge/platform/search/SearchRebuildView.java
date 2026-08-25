package io.knowledge.platform.search;

import java.time.OffsetDateTime;
import java.util.UUID;

public record SearchRebuildView(
        UUID id,
        UUID workspaceId,
        String status,
        String cursorType,
        UUID cursorId,
        long processedCount,
        long errorCount,
        UUID requestedBy,
        OffsetDateTime startedAt,
        OffsetDateTime updatedAt,
        OffsetDateTime completedAt,
        String lastError) {}
