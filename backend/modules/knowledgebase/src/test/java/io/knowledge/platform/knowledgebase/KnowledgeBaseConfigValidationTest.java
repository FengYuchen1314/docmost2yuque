package io.knowledge.platform.knowledgebase;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class KnowledgeBaseConfigValidationTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void preservesExtensionFieldsAndNormalizesSafeAppearanceCovers() {
        String value = KnowledgeBaseService.configJson(
                objectMapper,
                "{\"coverUrl\":\"https://cdn.example.com/cover.jpg\",\"extension\":{\"kept\":true}}",
                "Appearance",
                true);
        var parsed = objectMapper.readTree(value);

        assertEquals("https://cdn.example.com/cover.jpg", parsed.path("coverUrl").stringValue());
        assertEquals(true, parsed.path("extension").path("kept").booleanValue());
    }

    @Test
    void rejectsUnsafeAppearanceCoversAndNonObjectConfigs() {
        for (String cover : new String[] {
            "http://cdn.example.com/cover.jpg",
            "javascript:alert(1)",
            "https://user:secret@cdn.example.com/cover.jpg"
        }) {
            assertThrows(
                    IllegalArgumentException.class,
                    () -> KnowledgeBaseService.configJson(
                            objectMapper,
                            "{\"coverUrl\":\"" + cover + "\"}",
                            "Appearance",
                            true));
        }
        assertThrows(
                IllegalArgumentException.class,
                () -> KnowledgeBaseService.configJson(
                        objectMapper, "[]", "Catalog", false));
        assertThrows(
                IllegalArgumentException.class,
                () -> KnowledgeBaseService.configJson(
                        objectMapper, "{\"x\":\"" + "a".repeat(100_000) + "\"}", "Catalog", false));
    }
}
