package io.knowledge.platform.social;
import tools.jackson.databind.JsonNode;
public record PublicReaderView(
        PublicContentView metadata,
        JsonNode content,
        String plainText,
        int schemaVersion,
        JsonNode documentSettings,
        JsonNode pageMetadata,
        JsonNode appearanceConfig,
        JsonNode watermarkConfig) {}
