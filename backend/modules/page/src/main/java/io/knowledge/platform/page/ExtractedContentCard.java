package io.knowledge.platform.page;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

record ExtractedContentCard(
        UUID instanceId,
        String cardId,
        int version,
        JsonNode data,
        String sourcePointer,
        int ordinal,
        boolean supported) {}
