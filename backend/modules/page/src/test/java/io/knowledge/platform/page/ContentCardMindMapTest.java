package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardMindMapTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void validatesAcyclicStructuredBranchesAndLegacyRootOnlyData() {
        var legacy = mapper.createObjectNode().put("root", "产品架构");
        registry.validate("mind-map", 1, legacy);

        var data = legacy.deepCopy();
        var nodes = data.putArray("nodes");
        nodes.addObject().put("id", "frontend").putNull("parentId").put("text", "前端");
        nodes.addObject().put("id", "editor").put("parentId", "frontend").put("text", "编辑器");
        registry.validate("mind-map", 1, data);

        var cyclic = data.deepCopy();
        ((tools.jackson.databind.node.ObjectNode) cyclic.path("nodes").path(0)).put("parentId", "editor");
        assertThatThrownBy(() -> registry.validate("mind-map", 1, cyclic))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Mind map cannot contain cycles");
    }
}
