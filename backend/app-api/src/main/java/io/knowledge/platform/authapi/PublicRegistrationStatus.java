package io.knowledge.platform.authapi;

record PublicRegistrationStatus(
        boolean publicRegistrationEnabled,
        boolean emailVerificationRequired,
        boolean passwordLoginEnabled,
        boolean emailCodeLoginAvailable) {}
