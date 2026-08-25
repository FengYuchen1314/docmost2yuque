package io.knowledge.platform.mail;

import tools.jackson.databind.ObjectMapper;
import io.knowledge.platform.common.EmailAddress;
import io.knowledge.platform.common.SecretCipher;
import io.knowledge.platform.jobs.JobQueue;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SmtpSettingsService {

    private static final String SMTP_TEST_JOB = "smtp.test";

    private final SmtpSettingsRepository repository;
    private final SecretCipher cipher;
    private final JobQueue jobQueue;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    SmtpSettingsService(
            SmtpSettingsRepository repository,
            SecretCipher cipher,
            JobQueue jobQueue,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.cipher = cipher;
        this.jobQueue = jobQueue;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public SmtpSettingsView get() {
        return toView(repository.load());
    }

    @Transactional
    public SmtpSettingsView update(UpdateSmtpSettingsCommand command) {
        if (command.password() != null && command.clearPassword()) {
            throw new IllegalArgumentException(
                    "password and clearPassword cannot be supplied together");
        }
        SmtpSettingsRecord current = repository.load();
        String host = optionalText(command.host());
        Integer port = command.port();
        String security = command.security() == null ? null : command.security().name();
        String username = optionalText(command.username());
        String fromName = optionalText(command.fromName());
        String fromAddress = optionalEmail(command.fromAddress());
        String replyTo = optionalEmail(command.replyTo());
        String encryptedPassword = nextPassword(current, command);

        if (command.enabled()) {
            requireComplete(host, port, security, fromAddress);
        }

        boolean connectionChanged = !Objects.equals(current.host(), host)
                || !Objects.equals(current.port(), port)
                || !Objects.equals(current.security(), security)
                || !Objects.equals(current.username(), username)
                || !Objects.equals(current.encryptedPassword(), encryptedPassword)
                || !Objects.equals(current.fromAddress(), fromAddress);
        long nextVersion = current.configurationVersion() + 1;
        SmtpSettingsRecord updated = new SmtpSettingsRecord(
                host,
                port,
                security,
                username,
                encryptedPassword,
                fromName,
                fromAddress,
                replyTo,
                command.enabled(),
                nextVersion,
                connectionChanged ? null : current.testedAt(),
                connectionChanged ? "UNTESTED" : current.testStatus(),
                connectionChanged ? null : current.lastErrorCode());
        repository.update(updated, command.updatedBy(), OffsetDateTime.now(clock));
        return toView(updated);
    }

    @Transactional
    public void queueTest(UUID requestedBy, String recipient) {
        SmtpSettingsRecord settings = repository.load();
        requireComplete(
                settings.host(),
                settings.port(),
                settings.security(),
                settings.fromAddress());
        String normalizedRecipient = EmailAddress.parse(recipient).normalized();
        OffsetDateTime now = OffsetDateTime.now(clock);
        repository.markTesting(settings.configurationVersion(), requestedBy, now);
        SmtpTestPayload payload =
                new SmtpTestPayload(settings.configurationVersion(), normalizedRecipient);
        jobQueue.enqueue(
                SMTP_TEST_JOB,
                "smtp-test:" + settings.configurationVersion() + ":" + UUID.randomUUID(),
                objectMapper.valueToTree(payload),
                now,
                3);
    }

    @Transactional(readOnly = true)
    public boolean isReady() {
        return repository.load().ready();
    }

    @Transactional(readOnly = true)
    public long requireReadyConfigurationVersion() {
        SmtpSettingsRecord settings = repository.load();
        if (!settings.ready()) {
            throw new MailUnavailableException();
        }
        return settings.configurationVersion();
    }

    @Transactional(readOnly = true)
    public SmtpConfiguration loadConfiguration(long expectedVersion) {
        SmtpSettingsRecord settings = repository.load();
        if (settings.configurationVersion() != expectedVersion) {
            throw new IllegalStateException("SMTP settings version no longer exists");
        }
        requireComplete(
                settings.host(),
                settings.port(),
                settings.security(),
                settings.fromAddress());
        return new SmtpConfiguration(
                settings.host(),
                settings.port(),
                SmtpSecurity.valueOf(settings.security()),
                settings.username(),
                settings.encryptedPassword() == null
                        ? null
                        : cipher.decrypt("smtp.password", settings.encryptedPassword()),
                settings.fromName(),
                settings.fromAddress(),
                settings.replyTo(),
                settings.configurationVersion());
    }

    @Transactional(readOnly = true)
    public SmtpConfiguration loadReadyConfiguration(long expectedVersion) {
        SmtpSettingsRecord settings = repository.load();
        if (!settings.ready()) {
            throw new MailUnavailableException();
        }
        return loadConfiguration(expectedVersion);
    }

    @Transactional
    public void markTestResult(long version, boolean success, String errorCode) {
        repository.markTestResult(
                version, success, optionalText(errorCode), OffsetDateTime.now(clock));
    }

    private String nextPassword(
            SmtpSettingsRecord current,
            UpdateSmtpSettingsCommand command) {
        if (command.clearPassword()) {
            return null;
        }
        if (command.password() == null) {
            return current.encryptedPassword();
        }
        if (command.password().isBlank()) {
            throw new IllegalArgumentException("SMTP password cannot be blank");
        }
        return cipher.encrypt("smtp.password", command.password());
    }

    private static SmtpSettingsView toView(SmtpSettingsRecord settings) {
        return new SmtpSettingsView(
                settings.host(),
                settings.port(),
                settings.security() == null
                        ? null
                        : SmtpSecurity.valueOf(settings.security()),
                settings.username(),
                settings.encryptedPassword() != null,
                settings.fromName(),
                settings.fromAddress(),
                settings.replyTo(),
                settings.enabled(),
                settings.configurationVersion(),
                settings.testedAt(),
                settings.testStatus(),
                settings.lastErrorCode(),
                settings.ready());
    }

    private static void requireComplete(
            String host,
            Integer port,
            String security,
            String fromAddress) {
        if (host == null || port == null || security == null || fromAddress == null) {
            throw new IllegalArgumentException(
                    "SMTP host, port, security and fromAddress are required");
        }
        if (port < 1 || port > 65_535) {
            throw new IllegalArgumentException("SMTP port must be between 1 and 65535");
        }
    }

    private static String optionalEmail(String value) {
        return value == null || value.isBlank() ? null : EmailAddress.parse(value).normalized();
    }

    private static String optionalText(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
