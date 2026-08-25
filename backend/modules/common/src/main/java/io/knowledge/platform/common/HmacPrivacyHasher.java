package io.knowledge.platform.common;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
final class HmacPrivacyHasher implements PrivacyHasher {

    private static final int MINIMUM_KEY_BYTES = 32;

    private final byte[] key;

    HmacPrivacyHasher(
            @Value("${security.privacy-hash-key:${security.settings-master-key:}}")
                    String encodedKey) {
        this.key = decodeKey(encodedKey);
    }

    @Override
    public String hash(String context, String value) {
        if (key.length < MINIMUM_KEY_BYTES) {
            throw new IllegalStateException(
                    "PRIVACY_HASH_KEY or SETTINGS_MASTER_KEY must be a Base64-encoded key of at least 32 bytes");
        }
        if (context == null || !context.matches("[a-z][a-z0-9.-]{1,63}")) {
            throw new IllegalArgumentException("Privacy hash context is invalid");
        }
        if (value == null) {
            throw new IllegalArgumentException("Privacy hash value is required");
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            mac.update(("knowledge-platform:" + context + ":v1\u0000")
                    .getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Unable to compute privacy hash", exception);
        }
    }

    private static byte[] decodeKey(String encodedKey) {
        if (encodedKey == null || encodedKey.isBlank()) {
            return new byte[0];
        }
        try {
            return Base64.getDecoder().decode(encodedKey);
        } catch (IllegalArgumentException exception) {
            return new byte[0];
        }
    }
}
