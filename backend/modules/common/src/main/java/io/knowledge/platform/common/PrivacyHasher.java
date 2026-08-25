package io.knowledge.platform.common;

public interface PrivacyHasher {

    String hash(String context, String value);
}
