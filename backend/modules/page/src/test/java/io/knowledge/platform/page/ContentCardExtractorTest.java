package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardExtractorTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(objectMapper);
    private final ContentCardExtractor extractor =
            new ContentCardExtractor(objectMapper, registry);

    @Test
    void extractsVersionedTokenAndStructuredCard() {
        UUID first = UUID.fromString("0198fbe0-ae3d-7000-8000-000000000011");
        UUID second = UUID.fromString("0198fbe0-ae3d-7000-8000-000000000012");
        String encoded = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString("{\"value\":\"TODO\",\"label\":\"待处理\"}"
                        .getBytes(StandardCharsets.UTF_8));
        var content = objectMapper.createObjectNode();
        var children = content.putArray("content");
        children.addObject()
                .put("type", "paragraph")
                .put("text", "{{card:status|id=" + first + "|v=1|data=" + encoded + "}}");
        var structured = children.addObject().put("type", "contentCard");
        structured.putObject("attrs")
                .put("cardId", "divider")
                .put("instanceId", second.toString())
                .put("version", 1)
                .putObject("data");

        var cards = extractor.extract(content);

        assertThat(cards).hasSize(2);
        assertThat(cards.get(0).cardId()).isEqualTo("status");
        assertThat(cards.get(1).cardId()).isEqualTo("divider");
        assertThat(cards).allMatch(ExtractedContentCard::supported);
    }

    @Test
    void rejectsUnapprovedProviderHost() {
        var data = objectMapper.createObjectNode().put("url", "https://attacker.example/embed");

        assertThatIllegalArgumentException()
                .isThrownBy(() -> registry.validate("youtube", 1, data));
    }
}
