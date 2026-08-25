package io.knowledge.platform.authorizationapi;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

record RevokeAclRequest(@NotNull UUID aclEntryId) {}
