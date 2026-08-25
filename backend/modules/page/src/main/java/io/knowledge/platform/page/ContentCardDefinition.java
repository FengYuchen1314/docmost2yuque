package io.knowledge.platform.page;

import java.util.List;
import java.util.Set;
import tools.jackson.databind.JsonNode;

record ContentCardDefinition(
        String id,
        int version,
        String title,
        List<String> aliases,
        String category,
        String icon,
        boolean fullScreen,
        boolean interactive,
        Set<String> exportFormats,
        JsonNode initialData) {

    ContentCardDefinitionView view(boolean enabled) {
        return new ContentCardDefinitionView(
                id,
                version,
                title,
                aliases,
                category,
                icon,
                fullScreen,
                interactive,
                exportFormats,
                initialData.deepCopy(),
                enabled);
    }
}
