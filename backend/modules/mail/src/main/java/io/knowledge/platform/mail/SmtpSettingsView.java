package io.knowledge.platform.mail;

import java.time.OffsetDateTime;

public record SmtpSettingsView(
        String host,
        Integer port,
        SmtpSecurity security,
        String username,
        boolean hasPassword,
        String fromName,
        String fromAddress,
        String replyTo,
        boolean enabled,
        long configurationVersion,
        OffsetDateTime testedAt,
        String testStatus,
        String lastErrorCode,
        boolean ready) {}
