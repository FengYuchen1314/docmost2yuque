package io.knowledge.platform.common;

public interface SecretCipher {

    String encrypt(String context, String clearText);

    String decrypt(String context, String encoded);
}
