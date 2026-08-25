package io.knowledge.platform.identity;

import io.knowledge.platform.common.EmailAddress;
import io.knowledge.platform.common.Ids;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class IdentityService
        implements IdentityProvisioning,
                IdentityAuthentication,
                IdentityInvitationProvisioning,
                IdentityRegistration,
                IdentityPasswordManagement,
                IdentityAccountManagement {

    private final IdentityRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy passwordPolicy;
    private final Clock clock;

    IdentityService(
            IdentityRepository repository,
            PasswordEncoder passwordEncoder,
            PasswordPolicy passwordPolicy,
            Clock clock) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.passwordPolicy = passwordPolicy;
        this.clock = clock;
    }

    @Override
    public ProvisionedIdentity provisionBootstrapAdmin(String emailValue, String password) {
        EmailAddress email = EmailAddress.parse(emailValue);
        passwordPolicy.validate(password);

        UUID userId = Ids.next();
        OffsetDateTime now = OffsetDateTime.now(clock);
        repository.insertBootstrapAdmin(
                userId,
                email.original(),
                email.normalized(),
                passwordEncoder.encode(password),
                now);
        return new ProvisionedIdentity(userId, email.normalized());
    }

    @Override
    public AuthenticatedIdentity authenticatePassword(String emailValue, String password) {
        EmailAddress email;
        try {
            email = EmailAddress.parse(emailValue);
        } catch (IllegalArgumentException exception) {
            throw new InvalidCredentialsException();
        }
        IdentityRecord identity = repository.findActiveByEmail(email.normalized());
        if (identity == null
                || password == null
                || !passwordEncoder.matches(password, identity.passwordHash())) {
            throw new InvalidCredentialsException();
        }
        return new AuthenticatedIdentity(
                identity.userId(), identity.email(), identity.instanceAdmin());
    }

    @Override
    public AuthenticatedIdentity findOrCreateInvitedIdentity(
            String emailValue,
            String password) {
        EmailAddress email = EmailAddress.parse(emailValue);
        repository.lockEmail(email.normalized());
        IdentityRecord existing = repository.findActiveByEmail(email.normalized());
        if (existing != null) {
            return new AuthenticatedIdentity(
                    existing.userId(), existing.email(), existing.instanceAdmin());
        }
        passwordPolicy.validate(password);
        UUID userId = Ids.next();
        OffsetDateTime now = OffsetDateTime.now(clock);
        repository.insertInvitedUser(
                userId,
                email.original(),
                email.normalized(),
                passwordEncoder.encode(password),
                now);
        return new AuthenticatedIdentity(userId, email.normalized(), false);
    }

    @Override
    public PreparedRegistration prepare(String emailValue, String password) {
        EmailAddress email = EmailAddress.parse(emailValue);
        passwordPolicy.validate(password);
        return new PreparedRegistration(
                email.original(),
                email.normalized(),
                passwordEncoder.encode(password));
    }

    @Override
    public boolean activeIdentityExists(String emailNormalized) {
        return repository.findActiveByEmail(emailNormalized) != null;
    }

    @Override
    public AuthenticatedIdentity activatePublicRegistration(
            String emailOriginal,
            String emailNormalized,
            String passwordHash) {
        repository.lockEmail(emailNormalized);
        if (repository.emailExists(emailNormalized)) {
            throw new IdentityAlreadyExistsException();
        }
        UUID userId = Ids.next();
        OffsetDateTime now = OffsetDateTime.now(clock);
        repository.insertPublicSignupUser(
                userId, emailOriginal, emailNormalized, passwordHash, now);
        return new AuthenticatedIdentity(userId, emailNormalized, false);
    }

    @Override
    public AuthenticatedIdentity findActiveIdentity(String emailNormalized) {
        IdentityRecord identity = repository.findActiveByEmail(emailNormalized);
        if (identity == null) {
            throw new InvalidCredentialsException();
        }
        return new AuthenticatedIdentity(
                identity.userId(), identity.email(), identity.instanceAdmin());
    }

    @Override
    public UUID resetPassword(String emailNormalized, String newPassword) {
        passwordPolicy.validate(newPassword);
        repository.lockEmail(emailNormalized);
        IdentityRecord identity = repository.findActiveByEmail(emailNormalized);
        if (identity == null) {
            throw new InvalidCredentialsException();
        }
        if (!repository.updatePasswordForActiveEmail(
                emailNormalized,
                passwordEncoder.encode(newPassword),
                OffsetDateTime.now(clock))) {
            throw new InvalidCredentialsException();
        }
        return identity.userId();
    }

    @Override
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public AccountView get(UUID userId) {
        AccountView account = repository.account(userId);
        if (account == null) throw new InvalidCredentialsException();
        return account;
    }

    @Override
    @org.springframework.transaction.annotation.Transactional
    public AccountView updateDisplayName(UUID userId, String displayName) {
        String normalized = displayName == null || displayName.isBlank()
                ? null
                : displayName.trim();
        if (normalized != null && normalized.length() > 200) {
            throw new IllegalArgumentException("Display name is too long");
        }
        if (!repository.updateDisplayName(userId, normalized, OffsetDateTime.now(clock))) {
            throw new InvalidCredentialsException();
        }
        return get(userId);
    }

    @Override
    @org.springframework.transaction.annotation.Transactional
    public void changePassword(
            UUID userId,
            String currentPassword,
            String newPassword,
            String passwordConfirmation) {
        if (newPassword == null || !newPassword.equals(passwordConfirmation)) {
            throw new IllegalArgumentException("Password confirmation does not match");
        }
        IdentityRecord identity = repository.findActiveById(userId);
        if (identity == null
                || currentPassword == null
                || !passwordEncoder.matches(currentPassword, identity.passwordHash())) {
            throw new InvalidCredentialsException();
        }
        passwordPolicy.validate(newPassword);
        if (passwordEncoder.matches(newPassword, identity.passwordHash())) {
            throw new IllegalArgumentException("New password must be different from current password");
        }
        if (!repository.updatePasswordForActiveUser(
                userId, passwordEncoder.encode(newPassword), OffsetDateTime.now(clock))) {
            throw new InvalidCredentialsException();
        }
    }
}
