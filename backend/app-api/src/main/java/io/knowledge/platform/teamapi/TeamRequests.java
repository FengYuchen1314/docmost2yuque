package io.knowledge.platform.teamapi;

import java.util.UUID;

final class TeamRequests {

    private TeamRequests() {}

    record WorkspaceId(UUID workspaceId) {}

    record TeamId(UUID teamId) {}

    record Activity(UUID teamId, Integer limit, Integer offset) {}

    record Create(
            UUID workspaceId,
            String name,
            String slug,
            String description,
            String avatar,
            String visibility) {}

    record Update(
            UUID teamId,
            String name,
            String slug,
            String description,
            String avatar,
            String visibility) {}

    record Member(UUID teamId, UUID userId, String role) {}
}
