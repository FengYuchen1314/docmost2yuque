package io.knowledge.platform.engagement;

import java.util.UUID;

public record WorkbenchCollaborator(UUID userId, String displayName, String email) {}
