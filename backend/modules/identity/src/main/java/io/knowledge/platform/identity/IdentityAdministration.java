package io.knowledge.platform.identity;

import java.util.List;
import java.util.UUID;

/** Instance-level user administration. Callers must enforce the instance-admin route policy. */
public interface IdentityAdministration {

    List<InstanceUserView> list(String query, String status, int limit);

    InstanceUserPageView page(String query, String status, int limit, int offset);

    InstanceUserView updateStatus(UUID actorId, UUID userId, String status);

    InstanceUserView updateAdministrator(UUID actorId, UUID userId, boolean administrator);
}
