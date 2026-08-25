package io.knowledge.platform.authapi;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.UUID;

record VerifyRegistrationRequest(
        @NotNull UUID challengeId,
        @NotBlank @Pattern(regexp = "[0-9]{6}") String code) {}
