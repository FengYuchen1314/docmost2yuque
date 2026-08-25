package io.knowledge.platform.authorization;

import java.time.OffsetDateTime;
import java.util.Set;
import java.util.UUID;

public record AclEntryView(
        UUID id,
        UUID workspaceId,
        ResourceType resourceType,
        UUID resourceId,
        String subjectType,
        UUID subjectId,
        String role,
        String effect,
        Set<Capability> capabilities,
        UUID createdBy,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
