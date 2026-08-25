package io.knowledge.platform.page;

import java.util.List;
import java.util.UUID;

public record KnowledgeGraphView(
        UUID rootPageId,
        List<Node> nodes,
        List<Edge> edges,
        boolean truncated) {

    public record Node(
            UUID pageId,
            UUID knowledgeBaseId,
            String title,
            ContentType contentType) {}

    public record Edge(
            UUID referenceId,
            UUID sourcePageId,
            UUID targetPageId,
            ReferenceKind kind,
            EmbedMode mode) {}
}
