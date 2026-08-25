package io.knowledge.platform.authentication;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ChallengeAccepted(UUID challengeId, OffsetDateTime expiresAt) {}
