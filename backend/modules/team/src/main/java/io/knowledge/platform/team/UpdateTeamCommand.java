package io.knowledge.platform.team;

import java.util.UUID;

public record UpdateTeamCommand(
        UUID teamId,
        String name,
        String slug,
        String description,
        String avatar,
        String visibility) {}
