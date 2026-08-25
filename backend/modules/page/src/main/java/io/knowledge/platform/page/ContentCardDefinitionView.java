package io.knowledge.platform.page;

import java.util.List;
import java.util.Set;
import tools.jackson.databind.JsonNode;

public record ContentCardDefinitionView(
        String id,
        int version,
        String title,
        List<String> aliases,
        String category,
        String icon,
        boolean fullScreen,
        boolean interactive,
        Set<String> exportFormats,
        JsonNode initialData,
        boolean enabled) {}
