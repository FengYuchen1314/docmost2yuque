package io.knowledge.platform.authorization;

import java.util.List;
import java.util.Set;
import java.util.UUID;

public record AuthorizationDecision(
        UUID workspaceId,
        ResourceType resourceType,
        UUID resourceId,
        Set<Capability> capabilities,
        String visibility,
        long permissionVersion,
        List<String> sources) {

    public boolean allows(Capability capability) {
        return capabilities.contains(capability);
    }
}
