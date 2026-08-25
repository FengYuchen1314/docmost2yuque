package io.knowledge.platform.setup;

public record UpdateRegistrationSettings(
        RegistrationMode registrationMode,
        boolean passwordLoginEnabled,
        boolean emailCodeLoginEnabled) {}
