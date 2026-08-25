package io.knowledge.platform.identity;

public interface IdentityAuthentication {

    AuthenticatedIdentity authenticatePassword(String email, String password);
}
