package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardMentionTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void requiresAValidUserIdAndVisibleLabel() {
        var valid = mapper.createObjectNode()
                .put("userId", "0198fbe0-ae3d-7000-8000-000000000150")
                .put("label", "林静");
        registry.validate("mention", 1, valid);

        assertThatThrownBy(() -> registry.validate(
                        "mention", 1, valid.deepCopy().put("userId", "not-a-user")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> registry.validate(
                        "mention", 1, valid.deepCopy().put("label", "")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
