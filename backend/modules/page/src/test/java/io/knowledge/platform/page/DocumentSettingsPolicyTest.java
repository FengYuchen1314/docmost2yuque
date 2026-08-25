package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class DocumentSettingsPolicyTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void appliesStableDefaultsAndNormalizesKnownOptions() {
        var defaults = DocumentSettingsPolicy.normalize(mapper, null);
        assertThat(defaults.path("pageWidth").stringValue()).isEqualTo("STANDARD");
        assertThat(defaults.path("fontFamily").stringValue()).isEqualTo("SERIF");
        assertThat(defaults.path("fontSize").stringValue()).isEqualTo("MEDIUM");
        assertThat(defaults.path("paragraphSpacing").stringValue()).isEqualTo("NORMAL");
        assertThat(defaults.path("showOutline").booleanValue()).isTrue();

        var requested = mapper.createObjectNode()
                .put("pageWidth", "wide")
                .put("fontFamily", "sans")
                .put("fontSize", "large")
                .put("paragraphSpacing", "relaxed")
                .put("showOutline", false)
                .put("untrustedCss", "position:fixed");
        var normalized = DocumentSettingsPolicy.normalize(mapper, requested);
        assertThat(normalized.toString()).isEqualTo(
                "{\"pageWidth\":\"WIDE\",\"fontFamily\":\"SANS\",\"fontSize\":\"LARGE\",\"paragraphSpacing\":\"RELAXED\",\"showOutline\":false}");
    }

    @Test
    void rejectsUnsupportedValuesAndNonObjectPayloads() {
        assertThatThrownBy(() -> DocumentSettingsPolicy.normalize(
                        mapper, mapper.createObjectNode().put("fontSize", "HUGE")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> DocumentSettingsPolicy.normalize(
                        mapper, mapper.createArrayNode()))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
