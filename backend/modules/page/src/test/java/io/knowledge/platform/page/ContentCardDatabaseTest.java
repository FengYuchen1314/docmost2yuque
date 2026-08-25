package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

class ContentCardDatabaseTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void validatesFieldsViewsAndTypedRows() {
        var data = mapper.createObjectNode()
                .put("type", "database")
                .put("view", "KANBAN")
                .put("filter", "")
                .put("sortFieldId", "name");
        var fields = data.putArray("fields");
        fields.addObject().put("id", "name").put("name", "名称").put("type", "TEXT");
        fields.addObject().put("id", "status").put("name", "状态").put("type", "SELECT")
                .putArray("options").add("待处理").add("完成");
        var row = data.putArray("rows").addObject()
                .put("id", "row-one").put("createdAt", "2026-08-25T08:00:00Z");
        row.putObject("values").put("name", "首页").put("status", "待处理");
        registry.validate("database", 1, data);

        assertThatThrownBy(() -> registry.validate(
                        "database", 1, data.deepCopy().put("view", "UNKNOWN")))
                .isInstanceOf(IllegalArgumentException.class);
        var unknownCell = data.deepCopy();
        ((ObjectNode) unknownCell.path("rows").path(0).path("values")).put("missing", "值");
        assertThatThrownBy(() -> registry.validate("database", 1, unknownCell))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Database cell is invalid");
    }
}
