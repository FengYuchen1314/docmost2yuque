package io.knowledge.platform.page;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class PageInputValidationTest {

    @Test
    void acceptsOnlyCredentialFreeHttpsPageCovers() {
        assertEquals(
                "https://cdn.example.com/covers/guide.jpg",
                PageService.cover(" https://cdn.example.com/covers/guide.jpg "));
        assertNull(PageService.cover("  "));

        for (String value : new String[] {
            "http://cdn.example.com/cover.jpg",
            "javascript:alert(1)",
            "https://user:secret@cdn.example.com/cover.jpg",
            "//cdn.example.com/cover.jpg",
            "https://cdn.example.com/line\nbreak.jpg"
        }) {
            assertThrows(IllegalArgumentException.class, () -> PageService.cover(value));
        }
    }
}
