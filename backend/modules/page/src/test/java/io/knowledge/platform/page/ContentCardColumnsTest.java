package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardColumnsTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void validatesBoundedColumnLayouts() {
        var valid = mapper.createObjectNode().put("count", 2);
        var columns = valid.putArray("columns");
        columns.addObject().put("content", "左栏");
        columns.addObject().put("content", "右栏");
        valid.putArray("ratios").add(1).add(2);
        registry.validate("columns", 1, valid);

        var mismatched = valid.deepCopy().put("count", 3);
        assertThatThrownBy(() -> registry.validate("columns", 1, mismatched))
                .isInstanceOf(IllegalArgumentException.class);
        var unsafeRatio = valid.deepCopy();
        unsafeRatio.putArray("ratios").add(1).add(-1);
        assertThatThrownBy(() -> registry.validate("columns", 1, unsafeRatio))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
