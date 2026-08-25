package io.knowledge.platform.authorizationapi;

import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Set;
import java.util.UUID;

record GrantAclRequest(
        @NotNull ResourceType resourceType,
        @NotNull UUID resourceId,
        @NotBlank String subjectType,
        UUID subjectId,
        String role,
        @NotBlank String effect,
        Set<Capability> capabilities) {}
