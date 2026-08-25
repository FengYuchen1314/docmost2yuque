package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardBasicConfigurationTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void validatesTablesAndStructuredTextCards() {
        var table = mapper.createObjectNode();
        table.putArray("rows").addArray().add("名称").add("状态");
        registry.validate("table", 1, table);

        var uneven = mapper.createObjectNode();
        var rows = uneven.putArray("rows");
        rows.addArray().add("A").add("B");
        rows.addArray().add("C");
        assertThatThrownBy(() -> registry.validate("table", 1, uneven))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Table rows must have a consistent width");

        registry.validate("quote", 1, mapper.createObjectNode().put("text", "值得引用").put("source", "作者"));
        registry.validate("callout", 1, mapper.createObjectNode().put("tone", "WARNING").put("text", "请注意"));
        assertThatThrownBy(() -> registry.validate("callout", 1, mapper.createObjectNode().put("tone", "CUSTOM").put("text", "坏配置")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Callout tone is invalid");
    }
}
