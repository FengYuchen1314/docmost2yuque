package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardMediaTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void exposesAndValidatesImageWidthWithoutBreakingLegacyCards() {
        var definition = registry.find("image");
        assertThat(definition.initialData().path("width").stringValue()).isEqualTo("LARGE");

        var legacy = mapper.createObjectNode().put("url", "https://cdn.example.com/image.png");
        registry.validate("image", 1, legacy);

        for (String width : new String[] {"SMALL", "MEDIUM", "LARGE", "FULL"}) {
            registry.validate("image", 1, legacy.deepCopy().put("width", width));
        }

        assertThatThrownBy(() -> registry.validate(
                        "image",
                        1,
                        legacy.deepCopy().put("width", "CUSTOM")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Image width is invalid");

        assertThatThrownBy(() -> registry.validate(
                        "image",
                        1,
                        mapper.createObjectNode().put("url", "https://user:password@cdn.example.com/image.png")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Media cards require an attachment or HTTPS URL");
    }
}
