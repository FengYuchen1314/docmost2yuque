package io.knowledge.platform.invitation;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record ResolvedInvitation(
        UUID invitationId,
        UUID workspaceId,
        String workspaceName,
        String maskedEmail,
        String workspaceRole,
        List<UUID> targetTeamIds,
        List<InvitationKnowledgeBaseTarget> targetKnowledgeBaseRoles,
        boolean accountExists,
        OffsetDateTime expiresAt) {}
