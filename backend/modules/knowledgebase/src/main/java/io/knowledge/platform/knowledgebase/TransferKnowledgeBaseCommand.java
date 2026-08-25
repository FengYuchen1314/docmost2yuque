package io.knowledge.platform.knowledgebase;

import java.util.UUID;

public record TransferKnowledgeBaseCommand(
        UUID knowledgeBaseId,
        String ownerType,
        UUID ownerId) {}
