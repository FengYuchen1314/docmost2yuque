package io.knowledge.platform.usergroup;

import java.time.OffsetDateTime;
import java.util.UUID;

public record UserGroupMemberView(
        UUID userId,
        String email,
        String displayName,
        String workspaceRole,
        UUID addedBy,
        OffsetDateTime createdAt) {}
