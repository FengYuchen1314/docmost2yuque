package io.knowledge.platform.page;

import java.util.Locale;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

final class DocumentSettingsPolicy {

    private static final Set<String> PAGE_WIDTHS = Set.of("STANDARD", "WIDE");
    private static final Set<String> FONT_FAMILIES = Set.of("SERIF", "SANS");
    private static final Set<String> FONT_SIZES = Set.of("SMALL", "MEDIUM", "LARGE");
    private static final Set<String> PARAGRAPH_SPACING =
            Set.of("COMPACT", "NORMAL", "RELAXED");

    private DocumentSettingsPolicy() {}

    static JsonNode normalize(ObjectMapper mapper, JsonNode requested) {
        if (requested != null && !requested.isNull() && !requested.isObject()) {
            throw new IllegalArgumentException("Document settings must be an object");
        }
        JsonNode value = requested == null || requested.isNull()
                ? mapper.createObjectNode()
                : requested;
        JsonNode outline = value.path("showOutline");
        if (!outline.isMissingNode() && !outline.isNull() && !outline.isBoolean()) {
            throw new IllegalArgumentException("Document setting showOutline must be a boolean");
        }
        return mapper.createObjectNode()
                .put("pageWidth", option(value, "pageWidth", "STANDARD", PAGE_WIDTHS))
                .put("fontFamily", option(value, "fontFamily", "SERIF", FONT_FAMILIES))
                .put("fontSize", option(value, "fontSize", "MEDIUM", FONT_SIZES))
                .put(
                        "paragraphSpacing",
                        option(value, "paragraphSpacing", "NORMAL", PARAGRAPH_SPACING))
                .put("showOutline", outline.isMissingNode() || outline.isNull() || outline.booleanValue());
    }

    private static String option(
            JsonNode value, String field, String fallback, Set<String> supported) {
        JsonNode node = value.path(field);
        if (node.isMissingNode() || node.isNull()) return fallback;
        if (!node.isString()) {
            throw new IllegalArgumentException("Document setting " + field + " must be a string");
        }
        String normalized = node.stringValue().trim().toUpperCase(Locale.ROOT);
        if (!supported.contains(normalized)) {
            throw new IllegalArgumentException("Document setting " + field + " is invalid");
        }
        return normalized;
    }
}
