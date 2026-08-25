package io.knowledge.platform.social;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class SocialInputValidationTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void normalizesSafeInternalAndHttpsNavigationEntries() {
        var input = mapper.createArrayNode();
        input.addObject().put("label", " 关于 ").put("url", "/u/author").put("ignored", true);
        input.addObject().put("label", "官网").put("url", "https://example.com/articles");
        input.addObject().put("label", "章节").put("url", "#overview");

        assertThat(SocialService.navigation(mapper, input).toString())
                .isEqualTo("[{\"label\":\"关于\",\"url\":\"/u/author\"},{\"label\":\"官网\",\"url\":\"https://example.com/articles\"},{\"label\":\"章节\",\"url\":\"#overview\"}]");
    }

    @Test
    void rejectsExecutableProtocolRelativeAndMalformedNavigationUrls() {
        for (String value : new String[] {
            "javascript:alert(1)",
            "data:text/html,unsafe",
            "//evil.example/path",
            "http://example.com",
            "https://user:password@example.com",
            "https://"
        }) {
            assertThatThrownBy(() -> SocialService.navigationUrl(value))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void acceptsOnlyHttpsProfileAssets() {
        assertThat(SocialService.url(null)).isNull();
        assertThat(SocialService.url("https://cdn.example.com/avatar.png"))
                .isEqualTo("https://cdn.example.com/avatar.png");
        assertThatThrownBy(() -> SocialService.url("http://cdn.example.com/avatar.png"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("URL must use HTTPS");
    }

    @Test
    void rejectsMalformedNavigationShapes() {
        assertThatThrownBy(() -> SocialService.navigation(mapper, mapper.createObjectNode()))
                .isInstanceOf(IllegalArgumentException.class);
        var missingLabel = mapper.createArrayNode();
        missingLabel.addObject().put("url", "/safe");
        assertThatThrownBy(() -> SocialService.navigation(mapper, missingLabel))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
