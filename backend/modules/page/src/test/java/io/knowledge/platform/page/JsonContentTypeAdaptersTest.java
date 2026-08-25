package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class JsonContentTypeAdaptersTest {

    @Test
    void extractsVisibleTextWithoutSchemaNamesOrReferenceIds() {
        ObjectMapper objectMapper = new ObjectMapper();
        var content = objectMapper.createObjectNode();
        content.put("type", "doc");
        var paragraph = content.putArray("content").addObject();
        paragraph.put("type", "paragraph");
        paragraph.put("text", "visible words");
        paragraph.put("sourceId", "0198fbe0-ae3d-7000-8000-000000000001");

        String plainText = new JsonContentTypeAdapters.DocumentAdapter(objectMapper)
                .extractPlainText(content);

        assertThat(plainText).isEqualTo("visible words");
    }

    @Test
    void createsAWhiteboardThatMatchesTheEditorContract() {
        ObjectMapper objectMapper = new ObjectMapper();

        JsonNode content = new JsonContentTypeAdapters.WhiteboardAdapter(objectMapper)
                .createEmptyContent();

        assertThat(content.path("type").stringValue()).isEqualTo("whiteboard");
        assertThat(content.path("viewport").path("x").intValue()).isZero();
        assertThat(content.path("viewport").path("y").intValue()).isZero();
        assertThat(content.path("viewport").path("zoom").intValue()).isEqualTo(1);
        assertThat(content.path("elements").isArray()).isTrue();
        assertThat(content.path("elements").isEmpty()).isTrue();
    }
}
