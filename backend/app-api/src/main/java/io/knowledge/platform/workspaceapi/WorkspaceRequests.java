package io.knowledge.platform.workspaceapi;

import java.util.UUID;

final class WorkspaceRequests {

    private WorkspaceRequests() {}

    record Create(String name) {}

    record Id(UUID workspaceId) {}

    record Update(
            UUID workspaceId,
            String name,
            String defaultVisibility,
            String defaultPublishMode) {}

    record Member(UUID workspaceId, UUID userId, String role) {}

    record TransferOwnership(
            UUID workspaceId, UUID targetUserId, String confirmationName) {}

    record Archive(UUID workspaceId, String confirmationName) {}
}
