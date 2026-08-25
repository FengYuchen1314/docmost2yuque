package io.knowledge.platform.adminapi;

import io.knowledge.platform.mail.SmtpSecurity;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

record SmtpUpdateRequest(
        @Size(max = 255) String host,
        @Min(1) @Max(65_535) Integer port,
        SmtpSecurity security,
        @Size(max = 320) String username,
        @Size(max = 1_000) String password,
        boolean clearPassword,
        @Size(max = 200) String fromName,
        @Email @Size(max = 320) String fromAddress,
        @Email @Size(max = 320) String replyTo,
        boolean enabled) {}
