package io.knowledge.platform.share;

import java.time.OffsetDateTime;

public record ShareAccessToken(String accessToken, OffsetDateTime expiresAt) {}
