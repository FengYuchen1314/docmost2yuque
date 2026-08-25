package io.knowledge.platform.identity;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.common.DomainConflictException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdentityAdministrationService implements IdentityAdministration {

    private static final Set<String> FILTER_STATUSES =
            Set.of("ALL", "PENDING", "ACTIVE", "SUSPENDED");
    private static final Set<String> MUTABLE_STATUSES = Set.of("ACTIVE", "SUSPENDED");

    private final IdentityRepository repository;
    private final IdentitySessionManagement sessions;
    private final AuditService audit;
    private final Clock clock;

    IdentityAdministrationService(
            IdentityRepository repository,
            IdentitySessionManagement sessions,
            AuditService audit,
            Clock clock) {
        this.repository = repository;
        this.sessions = sessions;
        this.audit = audit;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public List<InstanceUserView> list(String query, String status, int limit) {
        String normalizedStatus = normalize(status == null ? "ALL" : status);
        if (!FILTER_STATUSES.contains(normalizedStatus)) {
            throw new IllegalArgumentException("Unsupported user status filter");
        }
        String normalizedQuery = query == null || query.isBlank() ? null : query.trim();
        if (normalizedQuery != null && normalizedQuery.length() > 200) {
            throw new IllegalArgumentException("User search query is too long");
        }
        return repository.listInstanceUsers(
                normalizedQuery,
                "ALL".equals(normalizedStatus) ? null : normalizedStatus,
                Math.max(1, Math.min(limit, 500)),
                0);
    }

    @Override
    @Transactional(readOnly = true)
    public InstanceUserPageView page(String query, String status, int limit, int offset) {
        String normalizedStatus = normalize(status == null ? "ALL" : status);
        if (!FILTER_STATUSES.contains(normalizedStatus)) {
            throw new IllegalArgumentException("Unsupported user status filter");
        }
        String normalizedQuery = query == null || query.isBlank() ? null : query.trim();
        if (normalizedQuery != null && normalizedQuery.length() > 200) {
            throw new IllegalArgumentException("User search query is too long");
        }
        int count = Math.max(1, Math.min(limit, 50));
        int start = Math.max(0, Math.min(offset, 1_000_000));
        List<InstanceUserView> rows = repository.listInstanceUsers(
                normalizedQuery,
                "ALL".equals(normalizedStatus) ? null : normalizedStatus,
                count + 1,
                start);
        boolean hasMore = rows.size() > count;
        List<InstanceUserView> items = List.copyOf(
                rows.subList(0, Math.min(rows.size(), count)));
        return new InstanceUserPageView(items, start + items.size(), hasMore);
    }

    @Override
    @Transactional
    public InstanceUserView updateStatus(UUID actorId, UUID userId, String status) {
        String normalizedStatus = normalize(status);
        if (!MUTABLE_STATUSES.contains(normalizedStatus)) {
            throw new IllegalArgumentException("User status must be ACTIVE or SUSPENDED");
        }
        IdentityRepository.AdministeredUser target = requireMutableTarget(actorId, userId);
        repository.updateUserStatus(userId, normalizedStatus, OffsetDateTime.now(clock));
        if ("SUSPENDED".equals(normalizedStatus)) sessions.revokeAll(userId);
        audit.success(null, actorId, "identity.user.status." + normalizedStatus.toLowerCase(Locale.ROOT),
                "USER", userId);
        return requireUser(userId);
    }

    @Override
    @Transactional
    public InstanceUserView updateAdministrator(
            UUID actorId, UUID userId, boolean administrator) {
        IdentityRepository.AdministeredUser target = requireMutableTarget(actorId, userId);
        if (administrator && !"ACTIVE".equals(target.status())) {
            throw new DomainConflictException(
                    "INSTANCE_ADMIN_USER_INACTIVE", "Only an active user can become an administrator");
        }
        if (administrator) {
            repository.grantInstanceAdministrator(userId, actorId, OffsetDateTime.now(clock));
        } else {
            repository.revokeInstanceAdministrator(userId);
        }
        sessions.revokeAll(userId);
        audit.success(null, actorId,
                administrator ? "identity.instance-admin.grant" : "identity.instance-admin.revoke",
                "USER", userId);
        return requireUser(userId);
    }

    private IdentityRepository.AdministeredUser requireMutableTarget(
            UUID actorId, UUID userId) {
        if (actorId == null || userId == null) {
            throw new IllegalArgumentException("Actor and user ids are required");
        }
        if (actorId.equals(userId)) {
            throw new DomainConflictException(
                    "INSTANCE_ADMIN_SELF_MUTATION", "Administrators cannot suspend or demote themselves");
        }
        IdentityRepository.AdministeredUser target = repository.administeredUserForUpdate(userId);
        if (target == null) throw new IllegalArgumentException("User was not found");
        if ("OWNER".equals(target.instanceRole())) {
            throw new DomainConflictException(
                    "INSTANCE_OWNER_PROTECTED", "The instance owner cannot be suspended or demoted");
        }
        return target;
    }

    private InstanceUserView requireUser(UUID userId) {
        InstanceUserView value = repository.instanceUser(userId);
        if (value == null) throw new IllegalArgumentException("User was not found");
        return value;
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Status is required");
        return value.trim().toUpperCase(Locale.ROOT);
    }
}
