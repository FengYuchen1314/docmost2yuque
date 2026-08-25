package io.knowledge.platform.adminapi;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

record InvitationListRequest(
        @NotNull UUID workspaceId,
        @Min(1) @Max(200) Integer limit,
        @Min(0) Integer offset) {}
