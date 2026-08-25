package io.knowledge.platform.integration;

import java.util.Set;
import java.util.UUID;

public record CredentialIdentity(UUID credentialId,String credentialType,UUID workspaceId,UUID userId,String email,boolean instanceAdmin,Set<String> scopes) {}
