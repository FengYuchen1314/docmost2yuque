package io.knowledge.platform.knowledgebase;

import java.time.OffsetDateTime;
import java.util.UUID;

public record KnowledgeBaseMemberView(
        UUID userId,
        String email,
        String displayName,
        String role,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
