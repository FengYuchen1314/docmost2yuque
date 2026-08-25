package io.knowledge.platform.workspace;

import java.util.UUID;

public interface WorkspaceProvisioning {

    ProvisionedWorkspace provisionInitialWorkspace(UUID ownerId, String workspaceName);

    ProvisionedWorkspace provisionPersonalWorkspace(UUID ownerId);

    void requireInvitableWorkspace(UUID workspaceId);

    void addMember(UUID workspaceId, UUID userId, String role);
}
