package io.knowledge.platform.adminapi;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

record CreateInvitationRequest(
        @NotNull UUID workspaceId,
        @NotBlank @Email @Size(max = 320) String email,
        @NotBlank @Pattern(regexp = "ADMIN|MEMBER|EXTERNAL") String workspaceRole,
        @Size(max = 50) List<@NotNull UUID> targetTeamIds,
        @Valid @Size(max = 100) List<InvitationKnowledgeBaseTargetRequest> targetKnowledgeBaseRoles,
        @Min(1) @Max(720) Integer expiresInHours) {}
