package io.knowledge.platform.authentication;

import io.knowledge.platform.common.EmailAddress;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.common.PrivacyHasher;
import io.knowledge.platform.common.SecretCipher;
import io.knowledge.platform.identity.AuthenticatedIdentity;
import io.knowledge.platform.identity.IdentityRegistration;
import io.knowledge.platform.identity.IdentityPasswordManagement;
import io.knowledge.platform.identity.IdentitySessionManagement;
import io.knowledge.platform.identity.PreparedRegistration;
import io.knowledge.platform.jobs.JobQueue;
import io.knowledge.platform.mail.SmtpSettingsService;
import io.knowledge.platform.setup.InstanceAdministrationService;
import io.knowledge.platform.setup.RegistrationMode;
import io.knowledge.platform.setup.RegistrationSettings;
import io.knowledge.platform.workspace.ProvisionedWorkspace;
import io.knowledge.platform.workspace.WorkspaceProvisioning;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class EmailAuthenticationService {

    private static final String PUBLIC_SIGNUP_PURPOSE = "PUBLIC_SIGNUP_VERIFY";
    private static final String PASSWORDLESS_PURPOSE = "PASSWORDLESS_LOGIN";
    private static final String PASSWORD_RESET_PURPOSE = "PASSWORD_RESET";
    private static final String DELIVERY_JOB_TYPE = "email.challenge.deliver";
    private static final Duration CHALLENGE_LIFETIME = Duration.ofMinutes(10);
    private static final Duration RATE_WINDOW = Duration.ofHours(1);
    private static final int MAXIMUM_EMAIL_REQUESTS = 5;
    private static final int MAXIMUM_IP_REQUESTS = 20;

    private final EmailChallengeRepository repository;
    private final IdentityRegistration identityRegistration;
    private final IdentityPasswordManagement passwordManagement;
    private final IdentitySessionManagement sessionManagement;
    private final WorkspaceProvisioning workspaceProvisioning;
    private final InstanceAdministrationService administrationService;
    private final SmtpSettingsService smtpSettingsService;
    private final PasswordEncoder passwordEncoder;
    private final SecretCipher secretCipher;
    private final PrivacyHasher privacyHasher;
    private final JobQueue jobQueue;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final SecureRandom secureRandom = new SecureRandom();

    EmailAuthenticationService(
            EmailChallengeRepository repository,
            IdentityRegistration identityRegistration,
            IdentityPasswordManagement passwordManagement,
            IdentitySessionManagement sessionManagement,
            WorkspaceProvisioning workspaceProvisioning,
            InstanceAdministrationService administrationService,
            SmtpSettingsService smtpSettingsService,
            PasswordEncoder passwordEncoder,
            SecretCipher secretCipher,
            PrivacyHasher privacyHasher,
            JobQueue jobQueue,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.identityRegistration = identityRegistration;
        this.passwordManagement = passwordManagement;
        this.sessionManagement = sessionManagement;
        this.workspaceProvisioning = workspaceProvisioning;
        this.administrationService = administrationService;
        this.smtpSettingsService = smtpSettingsService;
        this.passwordEncoder = passwordEncoder;
        this.secretCipher = secretCipher;
        this.privacyHasher = privacyHasher;
        this.jobQueue = jobQueue;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public RegistrationSettings registrationStatus() {
        return administrationService.getRegistrationSettings();
    }

    @Transactional
    public ChallengeAccepted startPublicRegistration(
            String email,
            String password,
            String passwordConfirmation,
            String remoteAddress) {
        RegistrationSettings settings = administrationService.getRegistrationSettings();
        if (settings.registrationMode() != RegistrationMode.PUBLIC) {
            throw new RegistrationClosedException();
        }
        if (password == null || !password.equals(passwordConfirmation)) {
            throw new IllegalArgumentException("Password confirmation does not match");
        }
        long smtpVersion = smtpSettingsService.requireReadyConfigurationVersion();
        PreparedRegistration prepared = identityRegistration.prepare(email, password);
        boolean deliverable =
                !identityRegistration.activeIdentityExists(prepared.emailNormalized());
        return createChallenge(
                prepared.emailNormalized(),
                PUBLIC_SIGNUP_PURPOSE,
                deliverable ? prepared.passwordHash() : null,
                deliverable,
                smtpVersion,
                remoteAddress);
    }

    @Transactional
    public CompletedRegistration verifyPublicRegistration(
            UUID challengeId,
            String code) {
        RegistrationSettings settings = administrationService.getRegistrationSettings();
        if (settings.registrationMode() != RegistrationMode.PUBLIC) {
            throw new RegistrationClosedException();
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        EmailChallengeRecord challenge = requireActive(
                repository.findByIdForUpdate(challengeId, PUBLIC_SIGNUP_PURPOSE), now);
        verifyCode(challenge, code, now);
        if (challenge.pendingPasswordHash() == null
                || challenge.encryptedDeliverySecret() == null) {
            repository.recordFailedAttempt(challenge, now);
            throw new EmailChallengeInvalidException();
        }
        AuthenticatedIdentity identity = identityRegistration.activatePublicRegistration(
                challenge.emailNormalized(),
                challenge.emailNormalized(),
                challenge.pendingPasswordHash());
        ProvisionedWorkspace workspace =
                workspaceProvisioning.provisionPersonalWorkspace(identity.userId());
        repository.consume(challenge.id(), now);
        return new CompletedRegistration(identity, workspace.workspaceId());
    }

    @Transactional
    public void requestPasswordlessLogin(String emailValue, String remoteAddress) {
        RegistrationSettings settings = administrationService.getRegistrationSettings();
        if (!settings.emailCodeLoginEnabled()) {
            throw new EmailCodeLoginDisabledException();
        }
        long smtpVersion = smtpSettingsService.requireReadyConfigurationVersion();
        EmailAddress email = EmailAddress.parse(emailValue);
        boolean deliverable = identityRegistration.activeIdentityExists(email.normalized());
        createChallenge(
                email.normalized(),
                PASSWORDLESS_PURPOSE,
                null,
                deliverable,
                smtpVersion,
                remoteAddress);
    }

    @Transactional
    public AuthenticatedIdentity verifyPasswordlessLogin(
            String emailValue,
            String code) {
        RegistrationSettings settings = administrationService.getRegistrationSettings();
        if (!settings.emailCodeLoginEnabled()) {
            throw new EmailCodeLoginDisabledException();
        }
        String email = EmailAddress.parse(emailValue).normalized();
        OffsetDateTime now = OffsetDateTime.now(clock);
        EmailChallengeRecord challenge = requireActive(
                repository.findLatestForUpdate(email, PASSWORDLESS_PURPOSE), now);
        verifyCode(challenge, code, now);
        if (challenge.encryptedDeliverySecret() == null) {
            repository.recordFailedAttempt(challenge, now);
            throw new EmailChallengeInvalidException();
        }
        AuthenticatedIdentity identity = identityRegistration.findActiveIdentity(email);
        repository.consume(challenge.id(), now);
        return identity;
    }

    @Transactional
    public ChallengeAccepted requestPasswordReset(
            String emailValue, String remoteAddress) {
        long smtpVersion = smtpSettingsService.requireReadyConfigurationVersion();
        EmailAddress email = EmailAddress.parse(emailValue);
        boolean deliverable = identityRegistration.activeIdentityExists(email.normalized());
        return createChallenge(
                email.normalized(),
                PASSWORD_RESET_PURPOSE,
                null,
                deliverable,
                smtpVersion,
                remoteAddress);
    }

    @Transactional
    public void completePasswordReset(
            UUID challengeId,
            String code,
            String password,
            String passwordConfirmation) {
        if (password == null || !password.equals(passwordConfirmation)) {
            throw new IllegalArgumentException("Password confirmation does not match");
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        EmailChallengeRecord challenge = requireActive(
                repository.findByIdForUpdate(challengeId, PASSWORD_RESET_PURPOSE), now);
        verifyCode(challenge, code, now);
        if (challenge.encryptedDeliverySecret() == null) {
            repository.recordFailedAttempt(challenge, now);
            throw new EmailChallengeInvalidException();
        }
        UUID userId = passwordManagement.resetPassword(challenge.emailNormalized(), password);
        sessionManagement.revokeAll(userId);
        repository.consume(challenge.id(), now);
    }

    private ChallengeAccepted createChallenge(
            String emailNormalized,
            String purpose,
            String pendingPasswordHash,
            boolean deliverable,
            long smtpVersion,
            String remoteAddress) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        String ipHash = privacyHasher.hash("auth-request-ip", normalizeAddress(remoteAddress));
        enforceRateLimits(emailNormalized, ipHash, now);
        String code = generateCode();
        UUID challengeId = Ids.next();
        OffsetDateTime expiresAt = now.plus(CHALLENGE_LIFETIME);
        repository.invalidatePrevious(emailNormalized, purpose, now);
        repository.insert(
                challengeId,
                emailNormalized,
                purpose,
                passwordEncoder.encode(code),
                deliverable ? secretCipher.encrypt("auth.code", code) : null,
                pendingPasswordHash,
                expiresAt,
                ipHash,
                now);
        if (deliverable) {
            EmailChallengeDeliveryPayload payload =
                    new EmailChallengeDeliveryPayload(challengeId, smtpVersion);
            jobQueue.enqueue(
                    DELIVERY_JOB_TYPE,
                    "email-challenge:" + challengeId,
                    objectMapper.valueToTree(payload),
                    now,
                    6);
        }
        return new ChallengeAccepted(challengeId, expiresAt);
    }

    private void enforceRateLimits(
            String emailNormalized,
            String ipHash,
            OffsetDateTime now) {
        OffsetDateTime since = now.minus(RATE_WINDOW);
        if (repository.countRecentByEmail(emailNormalized, since) >= MAXIMUM_EMAIL_REQUESTS
                || repository.countRecentByIp(ipHash, since) >= MAXIMUM_IP_REQUESTS) {
            throw new AuthenticationRateLimitedException();
        }
    }

    private void verifyCode(
            EmailChallengeRecord challenge,
            String code,
            OffsetDateTime now) {
        if (code == null
                || !code.matches("[0-9]{6}")
                || !passwordEncoder.matches(code, challenge.codeHash())) {
            repository.recordFailedAttempt(challenge, now);
            throw new EmailChallengeInvalidException();
        }
    }

    private static EmailChallengeRecord requireActive(
            EmailChallengeRecord challenge,
            OffsetDateTime now) {
        if (challenge == null
                || challenge.consumedAt() != null
                || challenge.attemptCount() >= 5
                || !challenge.expiresAt().isAfter(now)) {
            throw new EmailChallengeInvalidException();
        }
        return challenge;
    }

    private String generateCode() {
        return String.format(Locale.ROOT, "%06d", secureRandom.nextInt(1_000_000));
    }

    private static String normalizeAddress(String remoteAddress) {
        return remoteAddress == null || remoteAddress.isBlank()
                ? "unknown"
                : remoteAddress.trim();
    }
}
