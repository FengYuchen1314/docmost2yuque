package io.knowledge.platform.authapi;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;

record PasswordResetCompleteRequest(
        @NotNull UUID challengeId,
        @NotBlank @Pattern(regexp = "[0-9]{6}") String code,
        @NotBlank @Size(min = 10, max = 128) String password,
        @NotBlank @Size(min = 10, max = 128) String passwordConfirmation) {}
