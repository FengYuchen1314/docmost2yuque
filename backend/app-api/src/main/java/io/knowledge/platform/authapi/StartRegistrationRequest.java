package io.knowledge.platform.authapi;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

record StartRegistrationRequest(
        @NotBlank @Email @Size(max = 320) String email,
        @NotBlank @Size(min = 10, max = 128) String password,
        @NotBlank @Size(min = 10, max = 128) String passwordConfirmation) {}
