package io.knowledge.platform.share;

import java.time.OffsetDateTime;
import java.util.UUID;

public record CreateShareCommand(
        String resourceType,
        UUID resourceId,
        String shareType,
        String password,
        String role,
        Boolean requireApproval,
        OffsetDateTime expiresAt,
        Boolean allowCopy,
        Boolean allowDownload,
        Boolean allowExport,
        Boolean allowComment,
        Boolean allowSearchIndex) {}
