package io.knowledge.platform.identity;

import java.util.UUID;

public record AuthenticatedIdentity(UUID userId, String email, boolean instanceAdmin) {}
