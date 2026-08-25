package io.knowledge.platform.mail;

import java.util.UUID;

public record UpdateSmtpSettingsCommand(
        String host,
        Integer port,
        SmtpSecurity security,
        String username,
        String password,
        boolean clearPassword,
        String fromName,
        String fromAddress,
        String replyTo,
        boolean enabled,
        UUID updatedBy) {}
