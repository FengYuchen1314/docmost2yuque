package io.knowledge.platform.page;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record UpdatePageCommand(
        UUID pageId,
        long expectedRevision,
        String title,
        String path,
        String icon,
        String cover,
        String publishMode,
        String visibilityOverride,
        JsonNode documentSettings,
        JsonNode content,
        Integer schemaVersion,
        String revisionKind,
        String revisionDescription) {}
