package io.knowledge.platform.catalog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class CatalogInputValidationTest {

    @Test
    void acceptsOnlyCredentialFreeHttpsLinks() {
        assertEquals(
                "https://example.com/docs?q=release#current",
                CatalogService.url(
                        " https://example.com/docs?q=release#current ", CatalogNodeType.LINK));

        for (String value : new String[] {
            "http://example.com",
            "javascript:alert(1)",
            "https://user:secret@example.com/private",
            "https://example.com/line\nbreak",
            "//example.com/path"
        }) {
            assertThrows(
                    IllegalArgumentException.class,
                    () -> CatalogService.url(value, CatalogNodeType.LINK));
        }
        assertThrows(
                IllegalArgumentException.class,
                () -> CatalogService.url("https://example.com/" + "a".repeat(2_000), CatalogNodeType.LINK));
    }

    @Test
    void dropsUrlsFromNonLinkCatalogNodes() {
        assertNull(CatalogService.url("https://example.com", CatalogNodeType.GROUP));
        assertNull(CatalogService.url("https://example.com", CatalogNodeType.DOCUMENT));
    }
}
