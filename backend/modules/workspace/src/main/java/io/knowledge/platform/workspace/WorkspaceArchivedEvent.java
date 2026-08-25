package io.knowledge.platform.workspace;

import java.time.OffsetDateTime;
import java.util.UUID;

public record WorkspaceArchivedEvent(
        UUID workspaceId,
        UUID actorId,
        OffsetDateTime archivedAt) {}
