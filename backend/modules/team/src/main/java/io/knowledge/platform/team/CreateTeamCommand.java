package io.knowledge.platform.team;

import java.util.UUID;

public record CreateTeamCommand(
        UUID workspaceId,
        String name,
        String slug,
        String description,
        String avatar,
        String visibility) {}
