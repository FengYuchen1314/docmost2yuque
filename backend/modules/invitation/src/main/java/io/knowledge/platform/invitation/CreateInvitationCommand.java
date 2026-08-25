package io.knowledge.platform.invitation;

import java.util.List;
import java.util.UUID;

public record CreateInvitationCommand(
        UUID workspaceId,
        String email,
        String workspaceRole,
        List<UUID> targetTeamIds,
        List<InvitationKnowledgeBaseTarget> targetKnowledgeBaseRoles,
        int expiresInHours,
        UUID createdBy) {}
