package io.knowledge.platform.page;

import java.util.UUID;

public record PageCollaborationAccess(
        UUID pageId,
        UUID workspaceId,
        ContentType contentType,
        long permissionVersion) {}
