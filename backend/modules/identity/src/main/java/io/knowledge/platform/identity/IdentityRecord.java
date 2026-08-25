package io.knowledge.platform.identity;

import java.util.UUID;

record IdentityRecord(UUID userId, String email, String passwordHash, boolean instanceAdmin) {}
