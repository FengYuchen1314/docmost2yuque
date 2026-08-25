package io.knowledge.platform.audit;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AuditEventView(
        UUID id,
        UUID workspaceId,
        UUID actorId,
        String action,
        String resourceType,
        UUID resourceId,
        String outcome,
        String details,
        OffsetDateTime occurredAt) {}
