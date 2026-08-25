package io.knowledge.platform.invitation;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record InvitationView(
        UUID id,
        UUID workspaceId,
        String email,
        String workspaceRole,
        List<UUID> targetTeamIds,
        List<InvitationKnowledgeBaseTarget> targetKnowledgeBaseRoles,
        String status,
        OffsetDateTime expiresAt,
        OffsetDateTime sentAt) {}
