package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardGalleryTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void validatesGalleryImagesAndRejectsDuplicateAttachments() {
        var valid = mapper.createObjectNode();
        var items = valid.putArray("items");
        items.addObject().put("url", "https://cdn.example.com/one.png").put("alt", "第一张");
        items.addObject().put("url", "https://cdn.example.com/two.png").put("alt", "第二张");
        registry.validate("gallery", 1, valid);

        var empty = mapper.createObjectNode().putArray("items");
        assertThatThrownBy(() -> registry.validate("gallery", 1, empty))
                .isInstanceOf(IllegalArgumentException.class);

        var duplicate = mapper.createObjectNode();
        var duplicateItems = duplicate.putArray("items");
        duplicateItems.addObject().put("url", "/api/v1/attachments/0198fbe0-ae3d-7000-8000-000000000001/content").put("attachmentId", "0198fbe0-ae3d-7000-8000-000000000001");
        duplicateItems.addObject().put("url", "/api/v1/attachments/0198fbe0-ae3d-7000-8000-000000000001/content").put("attachmentId", "0198fbe0-ae3d-7000-8000-000000000001");
        assertThatThrownBy(() -> registry.validate("gallery", 1, duplicate))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Gallery attachment ids must be unique");
    }
}
