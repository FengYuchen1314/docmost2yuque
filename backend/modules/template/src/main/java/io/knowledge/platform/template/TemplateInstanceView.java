package io.knowledge.platform.template;

import java.util.Map;
import java.util.UUID;

public record TemplateInstanceView(
        UUID templateId, String targetResourceType, UUID targetResourceId,
        Map<UUID, UUID> resourceMapping) {}
