package io.knowledge.platform.common;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
final class AesGcmSecretCipher implements SecretCipher {

    private static final int KEY_BYTES = 32;
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final byte FORMAT_VERSION = 1;

    private final byte[] key;
    private final SecureRandom secureRandom = new SecureRandom();

    AesGcmSecretCipher(@Value("${security.settings-master-key:}") String encodedKey) {
        this.key = decodeKey(encodedKey);
    }

    @Override
    public String encrypt(String context, String clearText) {
        requireConfigured();
        requireContext(context);
        try {
            byte[] nonce = new byte[NONCE_BYTES];
            secureRandom.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.ENCRYPT_MODE,
                    new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(associatedData(context));
            byte[] encrypted = cipher.doFinal(clearText.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder()
                    .withoutPadding()
                    .encodeToString(ByteBuffer.allocate(1 + NONCE_BYTES + encrypted.length)
                            .put(FORMAT_VERSION)
                            .put(nonce)
                            .put(encrypted)
                            .array());
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Unable to encrypt application secret", exception);
        }
    }

    @Override
    public String decrypt(String context, String encoded) {
        requireConfigured();
        requireContext(context);
        try {
            ByteBuffer value = ByteBuffer.wrap(Base64.getUrlDecoder().decode(encoded));
            if (value.remaining() <= 1 + NONCE_BYTES || value.get() != FORMAT_VERSION) {
                throw new IllegalArgumentException("Unsupported encrypted secret format");
            }
            byte[] nonce = new byte[NONCE_BYTES];
            value.get(nonce);
            byte[] encrypted = new byte[value.remaining()];
            value.get(encrypted);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(associatedData(context));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw new IllegalStateException("Unable to decrypt application secret", exception);
        }
    }

    private void requireConfigured() {
        if (key.length != KEY_BYTES) {
            throw new IllegalStateException(
                    "SETTINGS_MASTER_KEY must be a Base64-encoded 32-byte key before storing application secrets");
        }
    }

    private static void requireContext(String context) {
        if (context == null || !context.matches("[a-z][a-z0-9.-]{1,63}")) {
            throw new IllegalArgumentException("Secret encryption context is invalid");
        }
    }

    private static byte[] associatedData(String context) {
        return ("knowledge-platform:" + context + ":v1").getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] decodeKey(String encodedKey) {
        if (encodedKey == null || encodedKey.isBlank()) {
            return new byte[0];
        }
        try {
            byte[] value = Base64.getDecoder().decode(encodedKey);
            return value.length == KEY_BYTES ? value : new byte[0];
        } catch (IllegalArgumentException exception) {
            return new byte[0];
        }
    }
}
