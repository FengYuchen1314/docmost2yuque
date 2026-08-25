package io.knowledge.platform.template;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record TemplateView(
        UUID id, UUID workspaceId, String templateType, String name, String description,
        String category, String thumbnail, UUID sourceResourceId, JsonNode snapshot,
        String visibility, long useCount, UUID createdBy, OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
