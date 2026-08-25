package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardExportServiceTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardExportService exports = new ContentCardExportService(mapper);

    @Test
    void flattensColumnsWithoutLeakingTheInternalToken() {
        var data = mapper.createObjectNode().put("count", 2);
        var columns = data.putArray("columns");
        columns.addObject().put("content", "左栏正文");
        columns.addObject().put("content", "右栏正文");
        data.putArray("ratios").add(1).add(2);
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(
                mapper.writeValueAsString(data).getBytes(StandardCharsets.UTF_8));
        String token = "{{card:columns|id=" + UUID.randomUUID() + "|v=1|data=" + encoded + "}}";

        assertThat(exports.markdown("前文\n" + token + "\n后文"))
                .contains("#### 第 1 栏", "左栏正文", "#### 第 2 栏", "右栏正文")
                .doesNotContain("{{card:");
        assertThat(exports.plainText(token))
                .isEqualTo("第 1 栏\n左栏正文\n\n第 2 栏\n右栏正文");
    }

    @Test
    void exportsTablesSemanticallyInMarkdownAndPlainText() {
        var data = mapper.createObjectNode();
        var rows = data.putArray("rows");
        rows.addArray().add("名称").add("状态");
        rows.addArray().add("首页").add("完成");
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(
                mapper.writeValueAsString(data).getBytes(StandardCharsets.UTF_8));
        String token = "{{card:table|id=" + UUID.randomUUID() + "|v=1|data=" + encoded + "}}";

        assertThat(exports.markdown(token))
                .isEqualTo("| 名称 | 状态 | \n| --- | --- | \n| 首页 | 完成 |");
        assertThat(exports.plainText(token)).isEqualTo("名称\t状态\n首页\t完成");
    }

    @Test
    void exportsOnlyTheVisibleMentionLabel() {
        var data = mapper.createObjectNode()
                .put("userId", "0198fbe0-ae3d-7000-8000-000000000156")
                .put("label", "林静");
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(
                mapper.writeValueAsString(data).getBytes(StandardCharsets.UTF_8));
        String token = "{{card:mention|id=" + UUID.randomUUID() + "|v=1|data=" + encoded + "}}";

        assertThat(exports.markdown(token)).isEqualTo("@林静").doesNotContain(data.path("userId").stringValue());
        assertThat(exports.plainText(token)).isEqualTo("@林静");
    }

    @Test
    void exportsKanbanColumnsAsReadableTaskLists() {
        var data = mapper.createObjectNode();
        var columns = data.putArray("columns");
        columns.addObject().put("id", "todo").put("title", "待处理").putArray("cards")
                .addObject().put("id", "one").put("title", "完成首页").put("description", "今天完成");
        columns.addObject().put("id", "done").put("title", "已完成").putArray("cards");
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(
                mapper.writeValueAsString(data).getBytes(StandardCharsets.UTF_8));
        String token = "{{card:kanban|id=" + UUID.randomUUID() + "|v=1|data=" + encoded + "}}";

        assertThat(exports.markdown(token)).contains("### 待处理", "- [ ] 完成首页 — 今天完成", "### 已完成");
        assertThat(exports.plainText(token)).contains("待处理", "- 完成首页：今天完成", "已完成");
    }

    @Test
    void exportsDatabaseFieldsAndTypedRowsAsATable() {
        var data = mapper.createObjectNode().put("type", "database").put("view", "TABLE");
        var fields = data.putArray("fields");
        fields.addObject().put("id", "name").put("name", "名称").put("type", "TEXT");
        fields.addObject().put("id", "tags").put("name", "标签").put("type", "MULTI_SELECT");
        var values = data.putArray("rows").addObject().put("id", "row-one").putObject("values");
        values.put("name", "首页").putArray("tags").add("设计").add("重要");
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(
                mapper.writeValueAsString(data).getBytes(StandardCharsets.UTF_8));
        String token = "{{card:database|id=" + UUID.randomUUID() + "|v=1|data=" + encoded + "}}";

        assertThat(exports.markdown(token)).contains("| 名称 | 标签 |", "| 首页 | 设计, 重要 |");
        assertThat(exports.plainText(token)).isEqualTo("名称\t标签\n首页\t设计, 重要");
    }

    @Test
    void exportsDrawingLabelsWithoutLeakingItsSerializedPayload() {
        var data = mapper.createObjectNode().put("type", "whiteboard");
        data.putObject("viewport").put("x", 0).put("y", 0).put("zoom", 1);
        data.putArray("elements").addObject()
                .put("id", "goal").put("kind", "RECT")
                .put("x", 20).put("y", 30).put("width", 180).put("height", 100)
                .put("text", "项目目标").put("color", "#ffffff");
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(
                mapper.writeValueAsString(data).getBytes(StandardCharsets.UTF_8));
        String token = "{{card:whiteboard|id=" + UUID.randomUUID() + "|v=1|data=" + encoded + "}}";

        assertThat(exports.markdown(token)).isEqualTo("**画板**\n- 项目目标").doesNotContain("viewport");
        assertThat(exports.plainText(token)).isEqualTo("画板\n- 项目目标");
    }

    @Test
    void exportsMindMapBranchesAsANestedList() {
        var data = mapper.createObjectNode().put("root", "产品架构");
        var nodes = data.putArray("nodes");
        nodes.addObject().put("id", "frontend").putNull("parentId").put("text", "前端");
        nodes.addObject().put("id", "editor").put("parentId", "frontend").put("text", "编辑器");
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(
                mapper.writeValueAsString(data).getBytes(StandardCharsets.UTF_8));
        String token = "{{card:mind-map|id=" + UUID.randomUUID() + "|v=1|data=" + encoded + "}}";

        assertThat(exports.markdown(token)).isEqualTo("**思维导图：产品架构**\n- 前端\n  - 编辑器");
        assertThat(exports.plainText(token)).isEqualTo("思维导图：产品架构\n- 前端\n  - 编辑器");
    }
}
