package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardDrawingTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void validatesStructuredWhiteboardAndExcalidrawElements() {
        var whiteboard = drawing("whiteboard");
        whiteboard.withArray("elements").addObject()
                .put("id", "shape-one")
                .put("kind", "RECT")
                .put("x", 20).put("y", 30).put("width", 180).put("height", 100)
                .put("text", "目标").put("color", "#ffffff");
        registry.validate("whiteboard", 1, whiteboard);

        var excalidraw = drawing("excalidraw");
        var stroke = excalidraw.withArray("elements").addObject()
                .put("id", "stroke-one")
                .put("kind", "FREEDRAW")
                .put("x", 0).put("y", 0).put("width", 80).put("height", 40)
                .put("text", "").put("color", "#4b6354");
        stroke.putArray("points").addArray().add(0).add(0);
        stroke.withArray("points").addArray().add(80).add(40);
        registry.validate("excalidraw", 1, excalidraw);

        var invalid = whiteboard.deepCopy();
        invalid.withArray("elements").addObject()
                .put("id", "shape-two").put("kind", "SCRIPT");
        assertThatThrownBy(() -> registry.validate("whiteboard", 1, invalid))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void validatesDrawioGraphAndRejectsUnsafeXml() {
        var data = mapper.createObjectNode().put("type", "drawio");
        data.putObject("viewport").put("x", 0).put("y", 0).put("zoom", 1);
        data.putArray("nodes").addObject()
                .put("id", "node-one").put("kind", "RECT")
                .put("x", 10).put("y", 20).put("width", 160).put("height", 80)
                .put("text", "开始").put("color", "#ffffff");
        data.putArray("edges");
        data.put("xml", "<mxfile><diagram name=\"Page-1\"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>");
        registry.validate("drawio", 1, data);

        var unsafe = data.deepCopy().put("xml", "<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><mxfile>&e;</mxfile>");
        assertThatThrownBy(() -> registry.validate("drawio", 1, unsafe))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Draw.io XML is unsafe");
    }

    private tools.jackson.databind.node.ObjectNode drawing(String type) {
        var data = mapper.createObjectNode().put("type", type);
        data.putObject("viewport").put("x", 0).put("y", 0).put("zoom", 1);
        data.putArray("elements");
        return data;
    }
}
