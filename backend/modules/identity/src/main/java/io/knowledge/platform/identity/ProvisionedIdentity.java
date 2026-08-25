package io.knowledge.platform.identity;

import java.util.UUID;

public record ProvisionedIdentity(UUID userId, String email) {}

