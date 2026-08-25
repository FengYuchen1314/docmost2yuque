package io.knowledge.platform.share;

import java.time.OffsetDateTime;
import java.util.UUID;

public record UpdateShareCommand(
        UUID shareId,
        String password,
        boolean clearPassword,
        String role,
        Boolean requireApproval,
        OffsetDateTime expiresAt,
        Boolean allowCopy,
        Boolean allowDownload,
        Boolean allowExport,
        Boolean allowComment,
        Boolean allowSearchIndex) {}
