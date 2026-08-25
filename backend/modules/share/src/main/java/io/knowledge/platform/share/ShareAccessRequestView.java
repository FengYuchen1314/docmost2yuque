package io.knowledge.platform.share;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ShareAccessRequestView(
        UUID id,
        UUID shareId,
        UUID requesterId,
        String requesterEmail,
        String requesterDisplayName,
        long policyVersion,
        String message,
        String status,
        UUID reviewedBy,
        OffsetDateTime reviewedAt,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
