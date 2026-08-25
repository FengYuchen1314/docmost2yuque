package io.knowledge.platform.authentication;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.knowledge.platform.common.PrivacyHasher;
import io.knowledge.platform.identity.AuthenticatedIdentity;
import io.knowledge.platform.identity.IdentityAuthentication;
import io.knowledge.platform.identity.InvalidCredentialsException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class PasswordAuthenticationServiceTest {

    private static final Clock CLOCK =
            Clock.fixed(Instant.parse("2026-08-25T12:00:00Z"), ZoneOffset.UTC);

    @Test
    void recordsARejectedPasswordWithoutPersistingRawIdentityOrAddress() {
        IdentityAuthentication identities = mock(IdentityAuthentication.class);
        PasswordLoginAttemptRepository attempts = mock(PasswordLoginAttemptRepository.class);
        doThrow(new InvalidCredentialsException())
                .when(identities).authenticatePassword("User@Example.COM", "wrong");
        PasswordAuthenticationService service = service(identities, attempts);

        assertThatThrownBy(() -> service.authenticate(
                        "User@Example.COM", "wrong", "203.0.113.8"))
                .isInstanceOf(InvalidCredentialsException.class);

        verify(attempts).lock("password-login-principal:user@example.com", "password-login-ip:203.0.113.8");
        verify(attempts).record(
                any(UUID.class),
                org.mockito.ArgumentMatchers.eq("password-login-principal:user@example.com"),
                org.mockito.ArgumentMatchers.eq("password-login-ip:203.0.113.8"),
                any());
        verify(attempts, never()).clearPrincipal(any());
    }

    @Test
    void rejectsBeforePasswordVerificationWhenPrincipalWindowIsExhausted() {
        IdentityAuthentication identities = mock(IdentityAuthentication.class);
        PasswordLoginAttemptRepository attempts = mock(PasswordLoginAttemptRepository.class);
        when(attempts.countPrincipal(any(), any()))
                .thenReturn(PasswordAuthenticationService.PRINCIPAL_LIMIT);
        PasswordAuthenticationService service = service(identities, attempts);

        assertThatThrownBy(() -> service.authenticate(
                        "user@example.com", "secret", "203.0.113.8"))
                .isInstanceOf(PasswordAuthenticationRateLimitedException.class);

        verify(identities, never()).authenticatePassword(any(), any());
        verify(attempts, never()).record(any(), any(), any(), any());
    }

    @Test
    void clearsPrincipalFailuresAfterSuccessfulAuthentication() {
        UUID userId = UUID.randomUUID();
        IdentityAuthentication identities = mock(IdentityAuthentication.class);
        PasswordLoginAttemptRepository attempts = mock(PasswordLoginAttemptRepository.class);
        when(identities.authenticatePassword("user@example.com", "correct"))
                .thenReturn(new AuthenticatedIdentity(userId, "user@example.com", false));
        PasswordAuthenticationService service = service(identities, attempts);

        AuthenticatedIdentity result = service.authenticate(
                "user@example.com", "correct", "203.0.113.8");

        assertThat(result.userId()).isEqualTo(userId);
        verify(attempts).clearPrincipal("password-login-principal:user@example.com");
        verify(attempts, never()).record(any(), any(), any(), any());
    }

    private static PasswordAuthenticationService service(
            IdentityAuthentication identities,
            PasswordLoginAttemptRepository attempts) {
        PrivacyHasher hasher = (context, value) -> context + ":" + value;
        return new PasswordAuthenticationService(identities, attempts, hasher, CLOCK);
    }
}
