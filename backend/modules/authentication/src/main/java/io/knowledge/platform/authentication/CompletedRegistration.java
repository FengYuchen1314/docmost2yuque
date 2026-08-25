package io.knowledge.platform.authentication;

import io.knowledge.platform.identity.AuthenticatedIdentity;
import java.util.UUID;

public record CompletedRegistration(
        AuthenticatedIdentity identity,
        UUID workspaceId) {}
