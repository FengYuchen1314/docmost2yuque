package io.knowledge.platform.identity;

public interface IdentityRegistration {

    PreparedRegistration prepare(String email, String password);

    boolean activeIdentityExists(String emailNormalized);

    AuthenticatedIdentity activatePublicRegistration(
            String emailOriginal,
            String emailNormalized,
            String passwordHash);

    AuthenticatedIdentity findActiveIdentity(String emailNormalized);
}
