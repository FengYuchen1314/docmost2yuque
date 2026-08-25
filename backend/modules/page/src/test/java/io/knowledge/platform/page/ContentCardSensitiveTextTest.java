package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardSensitiveTextTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void acceptsOnlyBoundedEncryptionEnvelopes() {
        var valid = mapper.createObjectNode()
                .put("ciphertext", "AAAAAAAAAAAAAAAAAAAAAAA")
                .put("salt", "AAAAAAAAAAAAAAAAAAAAAA")
                .put("iv", "AAAAAAAAAAAAAAAA")
                .put("kdf", "PBKDF2-SHA256")
                .put("iterations", 210_000)
                .put("hint", "团队密码");
        registry.validate("sensitive-text", 1, valid);

        assertThatThrownBy(() -> registry.validate("sensitive-text", 1, valid.deepCopy().put("iterations", 10)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Sensitive text iteration count is invalid");
        assertThatThrownBy(() -> registry.validate("sensitive-text", 1, valid.deepCopy().put("ciphertext", "not+base64")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
