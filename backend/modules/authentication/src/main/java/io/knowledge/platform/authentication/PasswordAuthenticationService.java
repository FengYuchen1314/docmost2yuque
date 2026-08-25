package io.knowledge.platform.authentication;

import io.knowledge.platform.common.EmailAddress;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.common.PrivacyHasher;
import io.knowledge.platform.identity.AuthenticatedIdentity;
import io.knowledge.platform.identity.IdentityAuthentication;
import io.knowledge.platform.identity.InvalidCredentialsException;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PasswordAuthenticationService {

    static final int PRINCIPAL_LIMIT = 10;
    static final int IP_LIMIT = 50;
    static final Duration WINDOW = Duration.ofMinutes(15);
    private static final Duration RETENTION = Duration.ofHours(24);

    private final IdentityAuthentication identities;
    private final PasswordLoginAttemptRepository attempts;
    private final PrivacyHasher privacyHasher;
    private final Clock clock;

    public PasswordAuthenticationService(
            IdentityAuthentication identities,
            PasswordLoginAttemptRepository attempts,
            PrivacyHasher privacyHasher,
            Clock clock) {
        this.identities = identities;
        this.attempts = attempts;
        this.privacyHasher = privacyHasher;
        this.clock = clock;
    }

    @Transactional(noRollbackFor = InvalidCredentialsException.class)
    public AuthenticatedIdentity authenticate(
            String emailValue, String password, String remoteAddress) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        String principalHash = privacyHasher.hash(
                "password-login-principal", normalizeEmail(emailValue));
        String ipHash = privacyHasher.hash(
                "password-login-ip", normalizeAddress(remoteAddress));
        attempts.lock(principalHash, ipHash);
        attempts.prune(now.minus(RETENTION));
        OffsetDateTime since = now.minus(WINDOW);
        if (attempts.countPrincipal(principalHash, since) >= PRINCIPAL_LIMIT
                || attempts.countIp(ipHash, since) >= IP_LIMIT) {
            throw new PasswordAuthenticationRateLimitedException();
        }
        try {
            AuthenticatedIdentity identity = identities.authenticatePassword(emailValue, password);
            attempts.clearPrincipal(principalHash);
            return identity;
        } catch (InvalidCredentialsException exception) {
            attempts.record(Ids.next(), principalHash, ipHash, now);
            throw exception;
        }
    }

    private static String normalizeEmail(String value) {
        try {
            return EmailAddress.parse(value).normalized();
        } catch (IllegalArgumentException exception) {
            return value == null ? "invalid" : value.strip().toLowerCase(Locale.ROOT);
        }
    }

    private static String normalizeAddress(String value) {
        return value == null || value.isBlank() ? "unknown" : value.strip();
    }
}
