package io.knowledge.platform.analytics;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record AnalyticsEventCommand(
        UUID workspaceId,
        UUID actorId,
        String anonymousVisitorHash,
        String resourceType,
        UUID resourceId,
        UUID knowledgeBaseId,
        String eventType,
        String sessionId,
        JsonNode metadata) {}
