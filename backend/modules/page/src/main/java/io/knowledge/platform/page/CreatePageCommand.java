package io.knowledge.platform.page;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record CreatePageCommand(
        UUID knowledgeBaseId,
        String title,
        String path,
        ContentType contentType,
        String icon,
        String cover,
        String publishMode,
        String visibilityOverride,
        JsonNode documentSettings,
        JsonNode content) {}
