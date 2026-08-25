package io.knowledge.platform.share;

import java.util.UUID;

public record ShareAcceptance(
        String resourceType,
        UUID resourceId,
        UUID knowledgeBaseId,
        String role,
        boolean alreadyAccepted) {}
