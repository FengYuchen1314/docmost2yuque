package io.knowledge.platform.mail;

import java.nio.charset.StandardCharsets;
import java.util.Properties;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.stereotype.Component;

@Component
final class SmtpProbe {

    void sendTest(SmtpConfiguration configuration, String recipient) {
        send(
                configuration,
                new OutboundEmail(
                        recipient,
                        "Knowledge Platform SMTP test",
                        "SMTP configuration test succeeded. Configuration version: "
                                + configuration.configurationVersion()));
    }

    void send(SmtpConfiguration configuration, OutboundEmail email) {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(configuration.host());
        sender.setPort(configuration.port());
        sender.setUsername(configuration.username());
        sender.setPassword(configuration.password());
        sender.setDefaultEncoding(StandardCharsets.UTF_8.name());
        Properties properties = sender.getJavaMailProperties();
        properties.setProperty("mail.smtp.auth", Boolean.toString(configuration.username() != null));
        properties.setProperty("mail.smtp.starttls.enable",
                Boolean.toString(configuration.security() == SmtpSecurity.STARTTLS));
        properties.setProperty("mail.smtp.starttls.required",
                Boolean.toString(configuration.security() == SmtpSecurity.STARTTLS));
        properties.setProperty("mail.smtp.ssl.enable",
                Boolean.toString(configuration.security() == SmtpSecurity.TLS));
        properties.setProperty("mail.smtp.connectiontimeout", "10000");
        properties.setProperty("mail.smtp.timeout", "10000");
        properties.setProperty("mail.smtp.writetimeout", "10000");

        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(configuration.fromAddress());
        message.setTo(email.recipient());
        if (configuration.replyTo() != null) {
            message.setReplyTo(configuration.replyTo());
        }
        message.setSubject(email.subject());
        message.setText(email.plainTextBody());
        sender.send(message);
    }
}
