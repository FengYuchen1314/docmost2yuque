package io.knowledge.platform.workspace;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkspaceManagementService {

    private final WorkspaceRepository repository;
    private final AuthorizationService authorization;
    private final AuditService auditService;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public WorkspaceManagementService(
            WorkspaceRepository repository,
            AuthorizationService authorization,
            AuditService auditService,
            ApplicationEventPublisher events,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.auditService = auditService;
        this.events = events;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<WorkspaceView> list(UUID actorId) {
        return repository.listForUser(actorId);
    }

    @Transactional
    public WorkspaceView createOrganization(UUID actorId, String name) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        UUID workspaceId = Ids.next();
        repository.insertWorkspace(
                workspaceId, actorId, "ORGANIZATION", requireName(name), now);
        auditService.success(
                workspaceId, actorId, "workspace.create", "WORKSPACE", workspaceId);
        return requireWorkspace(workspaceId, actorId);
    }

    @Transactional
    public WorkspaceView update(
            UUID actorId,
            UUID workspaceId,
            String name,
            String defaultVisibility,
            String defaultPublishMode) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.MANAGE);
        repository.updateSettings(
                workspaceId,
                requireName(name),
                visibility(defaultVisibility),
                publishMode(defaultPublishMode),
                OffsetDateTime.now(clock));
        auditService.success(
                workspaceId, actorId, "workspace.update", "WORKSPACE", workspaceId);
        return requireWorkspace(workspaceId, actorId);
    }

    @Transactional(readOnly = true)
    public List<WorkspaceMemberView> members(UUID actorId, UUID workspaceId) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.READ);
        return repository.members(workspaceId);
    }

    @Transactional
    public List<WorkspaceMemberView> updateMember(
            UUID actorId,
            UUID workspaceId,
            UUID userId,
            String role) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.MANAGE);
        String current = repository.membershipRole(workspaceId, userId);
        if (current == null) {
            throw new ResourceNotFoundException();
        }
        String normalized = role(role);
        if ("OWNER".equals(current)
                && !"OWNER".equals(normalized)
                && repository.ownerCountForUpdate(workspaceId) <= 1) {
            throw lastOwner();
        }
        repository.updateMemberRole(
                workspaceId, userId, normalized, OffsetDateTime.now(clock));
        authorization.invalidateWorkspace(workspaceId);
        auditService.success(
                workspaceId, actorId, "workspace.member.update", "WORKSPACE", workspaceId);
        return repository.members(workspaceId);
    }

    @Transactional
    public void removeMember(UUID actorId, UUID workspaceId, UUID userId) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.MANAGE);
        String current = repository.membershipRole(workspaceId, userId);
        if (current == null) {
            throw new ResourceNotFoundException();
        }
        if ("OWNER".equals(current) && repository.ownerCountForUpdate(workspaceId) <= 1) {
            throw lastOwner();
        }
        repository.removeMember(workspaceId, userId);
        authorization.invalidateWorkspace(workspaceId);
        auditService.success(
                workspaceId, actorId, "workspace.member.remove", "WORKSPACE", workspaceId);
    }

    @Transactional
    public List<WorkspaceMemberView> transferOwnership(
            UUID actorId,
            UUID workspaceId,
            UUID targetUserId,
            String confirmationName) {
        if (actorId == null || workspaceId == null || targetUserId == null) {
            throw new IllegalArgumentException(
                    "Actor, workspace and target user are required");
        }
        if (actorId.equals(targetUserId)) {
            throw new DomainConflictException(
                    "WORKSPACE_OWNERSHIP_TARGET_INVALID",
                    "Workspace ownership must be transferred to another member");
        }
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.MANAGE);
        WorkspaceRepository.WorkspaceOwnershipTarget target =
                repository.ownershipTargetForUpdate(workspaceId, actorId, targetUserId);
        if (target == null) throw new ResourceNotFoundException();
        if (!"ORGANIZATION".equals(target.workspaceType())) {
            throw new DomainConflictException(
                    "PERSONAL_WORKSPACE_PROTECTED",
                    "A personal workspace does not support ownership transfer");
        }
        if (!"OWNER".equals(target.actorRole())) {
            throw new DomainConflictException(
                    "WORKSPACE_OWNER_REQUIRED",
                    "Only a workspace owner can transfer ownership");
        }
        if (!"ACTIVE".equals(target.targetStatus())) {
            throw new DomainConflictException(
                    "WORKSPACE_OWNERSHIP_TARGET_INACTIVE",
                    "Workspace ownership can only be transferred to an active member");
        }
        if (confirmationName == null
                || !target.workspaceName().equals(confirmationName.trim())) {
            throw new DomainConflictException(
                    "WORKSPACE_CONFIRMATION_MISMATCH",
                    "Workspace name confirmation does not match");
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        if (!"OWNER".equals(target.targetRole())) {
            repository.updateMemberRole(workspaceId, targetUserId, "OWNER", now);
        }
        repository.updateMemberRole(workspaceId, actorId, "ADMIN", now);
        authorization.invalidateWorkspace(workspaceId);
        auditService.success(
                workspaceId,
                actorId,
                "workspace.ownership.transfer",
                "WORKSPACE",
                workspaceId);
        return repository.members(workspaceId);
    }

    @Transactional
    public void archive(
            UUID actorId,
            UUID workspaceId,
            String confirmationName) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.MANAGE);
        WorkspaceRepository.WorkspaceArchiveTarget target =
                repository.archiveTargetForUpdate(workspaceId, actorId);
        if (target == null) throw new ResourceNotFoundException();
        if (!"OWNER".equals(target.membershipRole())) {
            throw new DomainConflictException(
                    "WORKSPACE_OWNER_REQUIRED", "Only a workspace owner can delete the workspace");
        }
        if ("PERSONAL".equals(target.workspaceType())) {
            throw new DomainConflictException(
                    "PERSONAL_WORKSPACE_PROTECTED", "A personal workspace cannot be deleted");
        }
        if (confirmationName == null || !target.name().equals(confirmationName.trim())) {
            throw new DomainConflictException(
                    "WORKSPACE_CONFIRMATION_MISMATCH", "Workspace name confirmation does not match");
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        repository.archive(workspaceId, now);
        events.publishEvent(new WorkspaceArchivedEvent(workspaceId, actorId, now));
        authorization.invalidateWorkspace(workspaceId);
        auditService.success(
                workspaceId, actorId, "workspace.archive", "WORKSPACE", workspaceId);
    }

    private WorkspaceView requireWorkspace(UUID workspaceId, UUID actorId) {
        WorkspaceView workspace = repository.findForUser(workspaceId, actorId);
        if (workspace == null) {
            throw new ResourceNotFoundException();
        }
        return workspace;
    }

    private static String requireName(String value) {
        if (value == null || value.trim().length() < 2 || value.trim().length() > 120) {
            throw new IllegalArgumentException(
                    "Workspace name must be between 2 and 120 characters");
        }
        return value.trim();
    }

    private static String visibility(String value) {
        String normalized = value == null ? "PRIVATE" : value.toUpperCase(Locale.ROOT);
        if (!Set.of("PRIVATE", "WORKSPACE", "PUBLIC").contains(normalized)) {
            throw new IllegalArgumentException("Workspace default visibility is invalid");
        }
        return normalized;
    }

    private static String publishMode(String value) {
        String normalized = value == null ? "MANUAL" : value.toUpperCase(Locale.ROOT);
        if (!Set.of("MANUAL", "AUTO").contains(normalized)) {
            throw new IllegalArgumentException("Workspace default publish mode is invalid");
        }
        return normalized;
    }

    private static String role(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Workspace member role is required");
        }
        String normalized = value.toUpperCase(Locale.ROOT);
        if (!Set.of("OWNER", "ADMIN", "MEMBER", "EXTERNAL").contains(normalized)) {
            throw new IllegalArgumentException("Workspace member role is invalid");
        }
        return normalized;
    }

    private static DomainConflictException lastOwner() {
        return new DomainConflictException(
                "WORKSPACE_LAST_OWNER", "A workspace must retain at least one owner");
    }
}
