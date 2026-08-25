package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class PageReferenceExtractorTest {

    private static final UUID PAGE_ID =
            UUID.fromString("0198fbe0-ae3d-7000-8000-000000000001");
    private static final UUID PUBLICATION_ID =
            UUID.fromString("0198fbe0-ae3d-7000-8000-000000000002");
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final PageReferenceExtractor extractor = new PageReferenceExtractor(objectMapper);

    @Test
    void extractsTextTokensAndStructuredReferences() {
        var content = objectMapper.createObjectNode();
        var children = content.putArray("content");
        children.addObject()
                .put("type", "paragraph")
                .put(
                        "text",
                        "[[page:" + PAGE_ID + "|mode=card]] @page ignored {{embed:"
                                + PAGE_ID
                                + "#intro|mode=fixed|publication="
                                + PUBLICATION_ID
                                + "}}");
        children.addObject()
                .put("type", "pageMention")
                .putObject("attrs")
                .put("pageId", PAGE_ID.toString());

        var references = extractor.extract(content);

        assertThat(references).hasSize(3);
        assertThat(references.get(0).mode()).isEqualTo(EmbedMode.CARD);
        assertThat(references.get(1).kind()).isEqualTo(ReferenceKind.BLOCK_REFERENCE);
        assertThat(references.get(1).fixedPublicationId()).isEqualTo(PUBLICATION_ID);
        assertThat(references.get(2).kind()).isEqualTo(ReferenceKind.MENTION);
    }

    @Test
    void fixedEmbedRequiresPublication() {
        var content = objectMapper.createObjectNode()
                .put("type", "paragraph")
                .put("text", "{{embed:" + PAGE_ID + "|mode=fixed}}");

        assertThatIllegalArgumentException().isThrownBy(() -> extractor.extract(content));
    }
}
