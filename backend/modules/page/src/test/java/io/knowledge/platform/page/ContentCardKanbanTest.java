package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

class ContentCardKanbanTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void validatesColumnsCardsAndStableIds() {
        var data = mapper.createObjectNode();
        var columns = data.putArray("columns");
        var todo = columns.addObject().put("id", "todo").put("title", "待处理").put("color", "#5f8f72");
        todo.putArray("cards").addObject().put("id", "card-one").put("title", "完成首页").put("description", "今天完成");
        columns.addObject().put("id", "done").put("title", "已完成").putArray("cards");
        registry.validate("kanban", 1, data);

        var duplicate = data.deepCopy();
        ((ObjectNode) duplicate.path("columns").path(1)).put("id", "card-one");
        assertThatThrownBy(() -> registry.validate("kanban", 1, duplicate))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Kanban ids must be unique");
        var empty = mapper.createObjectNode();
        empty.putArray("columns");
        assertThatThrownBy(() -> registry.validate("kanban", 1, empty))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
