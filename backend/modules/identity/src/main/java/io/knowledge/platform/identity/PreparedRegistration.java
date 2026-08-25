package io.knowledge.platform.identity;

public record PreparedRegistration(
        String emailOriginal,
        String emailNormalized,
        String passwordHash) {}
