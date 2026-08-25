package io.knowledge.platform.share;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ShareView(
        UUID id,
        UUID workspaceId,
        String resourceType,
        UUID resourceId,
        String shareType,
        boolean passwordProtected,
        String role,
        boolean requireApproval,
        OffsetDateTime expiresAt,
        boolean allowCopy,
        boolean allowDownload,
        boolean allowExport,
        boolean allowComment,
        boolean allowSearchIndex,
        long policyVersion,
        UUID createdBy,
        OffsetDateTime revokedAt,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
