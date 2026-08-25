package io.knowledge.platform.setup;

record InstanceAuthSettings(
        String registrationMode,
        boolean passwordLoginEnabled,
        boolean emailCodeLoginEnabled,
        long settingsVersion) {}
