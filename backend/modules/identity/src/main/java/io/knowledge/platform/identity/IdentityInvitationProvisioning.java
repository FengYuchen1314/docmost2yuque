package io.knowledge.platform.identity;

public interface IdentityInvitationProvisioning {

    boolean activeIdentityExists(String emailNormalized);

    AuthenticatedIdentity findOrCreateInvitedIdentity(String email, String password);
}
