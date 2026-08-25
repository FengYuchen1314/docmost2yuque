package io.knowledge.platform.template;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class TemplateInputValidationTest {

    @Test
    void acceptsOnlyCredentialFreeHttpsThumbnails() {
        assertEquals(
                "https://cdn.example.com/templates/weekly.jpg",
                TemplateService.thumbnail(" https://cdn.example.com/templates/weekly.jpg "));
        assertNull(TemplateService.thumbnail(""));

        for (String value : new String[] {
            "http://cdn.example.com/template.jpg",
            "javascript:alert(1)",
            "https://user:secret@cdn.example.com/template.jpg",
            "//cdn.example.com/template.jpg"
        }) {
            assertThrows(IllegalArgumentException.class, () -> TemplateService.thumbnail(value));
        }
    }
}
