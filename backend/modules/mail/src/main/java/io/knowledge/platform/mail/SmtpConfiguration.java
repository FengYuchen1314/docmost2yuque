package io.knowledge.platform.mail;

record SmtpConfiguration(
        String host,
        int port,
        SmtpSecurity security,
        String username,
        String password,
        String fromName,
        String fromAddress,
        String replyTo,
        long configurationVersion) {}
