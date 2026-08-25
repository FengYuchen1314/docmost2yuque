package io.knowledge.platform.security;

import java.io.Serializable;
import java.util.UUID;

public record PlatformPrincipal(UUID userId, String email, boolean instanceAdmin)
        implements Serializable {}
