package io.knowledge.platform.authentication;

import java.util.UUID;

public record EmailChallengeDeliveryPayload(
        UUID challengeId,
        long smtpSettingsVersion) {}
