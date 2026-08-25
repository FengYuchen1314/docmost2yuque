package io.knowledge.platform.authentication;

import java.time.OffsetDateTime;
import java.util.UUID;

record EmailChallengeRecord(
        UUID id,
        String emailNormalized,
        String purpose,
        String codeHash,
        String encryptedDeliverySecret,
        String pendingPasswordHash,
        OffsetDateTime expiresAt,
        OffsetDateTime consumedAt,
        int attemptCount,
        OffsetDateTime createdAt) {}
