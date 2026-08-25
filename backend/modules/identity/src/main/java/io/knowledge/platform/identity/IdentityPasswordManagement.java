package io.knowledge.platform.identity;

import java.util.UUID;

/** Password mutation boundary used by authenticated account and recovery workflows. */
public interface IdentityPasswordManagement {

    UUID resetPassword(String emailNormalized, String newPassword);
}
