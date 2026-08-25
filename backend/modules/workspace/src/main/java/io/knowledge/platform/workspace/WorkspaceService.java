package io.knowledge.platform.workspace;

import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkspaceService implements WorkspaceProvisioning {

    private final WorkspaceRepository repository;
    private final Clock clock;

    WorkspaceService(WorkspaceRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Override
    @Transactional
    public ProvisionedWorkspace provisionInitialWorkspace(UUID ownerId, String workspaceName) {
        String normalizedName = requireWorkspaceName(workspaceName);
        UUID workspaceId = Ids.next();
        repository.insertWorkspace(
                workspaceId,
                ownerId,
                "ORGANIZATION",
                normalizedName,
                OffsetDateTime.now(clock));
        return new ProvisionedWorkspace(workspaceId, normalizedName);
    }

    @Override
    @Transactional
    public ProvisionedWorkspace provisionPersonalWorkspace(UUID ownerId) {
        if (ownerId == null) {
            throw new IllegalArgumentException("Personal workspace owner is required");
        }
        repository.lockUser(ownerId);
        ProvisionedWorkspace existing = repository.personalWorkspace(ownerId);
        if (existing != null) {
            return existing;
        }
        UUID workspaceId = Ids.next();
        String name = "我的空间";
        repository.insertWorkspace(
                workspaceId,
                ownerId,
                "PERSONAL",
                name,
                OffsetDateTime.now(clock));
        return new ProvisionedWorkspace(workspaceId, name);
    }

    @Override
    @Transactional(readOnly = true)
    public void requireInvitableWorkspace(UUID workspaceId) {
        if (workspaceId == null) {
            throw new IllegalArgumentException("Invitation workspace is required");
        }
        String workspaceType = repository.activeWorkspaceType(workspaceId);
        if (workspaceType == null) {
            throw new ResourceNotFoundException();
        }
        if (!"ORGANIZATION".equals(workspaceType)) {
            throw new DomainConflictException(
                    "PERSONAL_WORKSPACE_INVITATIONS_DISABLED",
                    "A personal workspace cannot have invited members");
        }
    }

    @Override
    @Transactional
    public void addMember(UUID workspaceId, UUID userId, String role) {
        if (!java.util.Set.of("ADMIN", "MEMBER", "EXTERNAL").contains(role)) {
            throw new IllegalArgumentException("Invitation workspace role is invalid");
        }
        requireInvitableWorkspace(workspaceId);
        repository.insertMemberIfAbsent(
                workspaceId, userId, role, OffsetDateTime.now(clock));
    }

    private static String requireWorkspaceName(String workspaceName) {
        if (workspaceName == null) {
            throw new IllegalArgumentException("Workspace name is required");
        }
        String value = workspaceName.trim();
        if (value.length() < 2 || value.length() > 120) {
            throw new IllegalArgumentException(
                    "Workspace name must be between 2 and 120 characters");
        }
        return value;
    }
}
