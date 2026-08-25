package io.knowledge.platform.mail;

import java.time.OffsetDateTime;

record SmtpSettingsRecord(
        String host,
        Integer port,
        String security,
        String username,
        String encryptedPassword,
        String fromName,
        String fromAddress,
        String replyTo,
        boolean enabled,
        long configurationVersion,
        OffsetDateTime testedAt,
        String testStatus,
        String lastErrorCode) {

    boolean ready() {
        return enabled && "SUCCESS".equals(testStatus);
    }
}
