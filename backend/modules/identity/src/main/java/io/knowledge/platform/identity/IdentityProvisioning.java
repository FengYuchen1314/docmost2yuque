package io.knowledge.platform.identity;

public interface IdentityProvisioning {

    ProvisionedIdentity provisionBootstrapAdmin(String email, String password);
}

