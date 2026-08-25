package io.knowledge.platform.authorizationapi;

import io.knowledge.platform.authorization.ResourceType;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

record AuthorizationRequest(
        @NotNull ResourceType resourceType,
        @NotNull UUID resourceId) {}
