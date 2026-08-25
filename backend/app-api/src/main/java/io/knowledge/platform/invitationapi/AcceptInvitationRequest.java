package io.knowledge.platform.invitationapi;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

record AcceptInvitationRequest(
        @NotBlank @Size(min = 32, max = 256) String token,
        @Size(min = 10, max = 128) String password,
        @Size(min = 10, max = 128) String passwordConfirmation) {}
