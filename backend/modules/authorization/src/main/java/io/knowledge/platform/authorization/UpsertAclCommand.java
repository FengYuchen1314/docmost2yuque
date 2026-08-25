package io.knowledge.platform.authorization;

import java.util.Set;
import java.util.UUID;

public record UpsertAclCommand(
        ResourceType resourceType,
        UUID resourceId,
        String subjectType,
        UUID subjectId,
        String role,
        String effect,
        Set<Capability> capabilities) {}
