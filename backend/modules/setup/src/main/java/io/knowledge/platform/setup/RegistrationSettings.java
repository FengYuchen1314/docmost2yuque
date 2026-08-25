package io.knowledge.platform.setup;

public record RegistrationSettings(
        RegistrationMode registrationMode,
        boolean passwordLoginEnabled,
        boolean emailCodeLoginEnabled,
        boolean smtpReady,
        long settingsVersion) {}
