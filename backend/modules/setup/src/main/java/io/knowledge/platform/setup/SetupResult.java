package io.knowledge.platform.setup;

import java.util.UUID;

public record SetupResult(UUID userId, UUID workspaceId, String email, String workspaceName) {}

