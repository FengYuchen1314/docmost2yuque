package io.knowledge.platform.identity;

import java.util.UUID;

public interface IdentityAccountManagement {

    AccountView get(UUID userId);

    AccountView updateDisplayName(UUID userId, String displayName);

    void changePassword(
            UUID userId,
            String currentPassword,
            String newPassword,
            String passwordConfirmation);
}
