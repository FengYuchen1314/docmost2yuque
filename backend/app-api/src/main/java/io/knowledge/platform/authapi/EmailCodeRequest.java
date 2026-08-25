package io.knowledge.platform.authapi;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

record EmailCodeRequest(@NotBlank @Email @Size(max = 320) String email) {}
