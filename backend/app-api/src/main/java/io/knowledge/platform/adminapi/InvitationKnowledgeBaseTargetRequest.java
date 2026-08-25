package io.knowledge.platform.adminapi;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.UUID;

record InvitationKnowledgeBaseTargetRequest(
        @NotNull UUID knowledgeBaseId,
        @NotBlank @Pattern(regexp = "MANAGER|EDITOR|READER") String role) {}
