package io.knowledge.platform.page;

import tools.jackson.databind.JsonNode;

public interface ContentTypeAdapter {

    ContentType type();

    JsonNode createEmptyContent();

    void validate(JsonNode content, int schemaVersion);

    String extractPlainText(JsonNode content);
}
