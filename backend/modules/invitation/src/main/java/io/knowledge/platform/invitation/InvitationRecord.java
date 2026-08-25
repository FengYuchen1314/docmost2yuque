package io.knowledge.platform.invitation;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

record InvitationRecord(
        UUID id,
        UUID workspaceId,
        String workspaceName,
        String emailOriginal,
        String emailNormalized,
        String tokenHash,
        String encryptedDeliveryToken,
        String workspaceRole,
        List<UUID> targetTeamIds,
        List<InvitationKnowledgeBaseTarget> targetKnowledgeBaseRoles,
        String status,
        long smtpSettingsVersion,
        OffsetDateTime expiresAt,
        OffsetDateTime sentAt) {}
