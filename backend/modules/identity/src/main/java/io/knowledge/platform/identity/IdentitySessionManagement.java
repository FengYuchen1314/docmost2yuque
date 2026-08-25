package io.knowledge.platform.identity;

import java.util.List;
import java.util.UUID;

/** Durable login-session boundary shared by the HTTP security layer and account settings. */
public interface IdentitySessionManagement {

    boolean touch(
            UUID userId,
            String httpSessionId,
            String userAgent,
            String ipAddress);

    List<AccountSessionView> list(UUID userId, String currentHttpSessionId);

    boolean revoke(UUID userId, UUID sessionId, String currentHttpSessionId);

    void revokeOthers(UUID userId, String currentHttpSessionId);

    void revokeAll(UUID userId);

    void revokeHttpSession(String httpSessionId, String reason);
}
