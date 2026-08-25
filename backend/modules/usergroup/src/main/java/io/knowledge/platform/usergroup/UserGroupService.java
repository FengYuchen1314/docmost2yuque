package io.knowledge.platform.usergroup;

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
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserGroupService {

    private final UserGroupRepository repository;
    private final AuthorizationService authorization;
    private final AuditService auditService;
    private final Clock clock;

    public UserGroupService(
            UserGroupRepository repository,
            AuthorizationService authorization,
            AuditService auditService,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<UserGroupView> list(UUID actorId, UUID workspaceId) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.READ);
        return repository.list(workspaceId);
    }

    @Transactional
    public UserGroupView create(
            UUID actorId, UUID workspaceId, String name, String description) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.MANAGE);
        UUID id = Ids.next();
        OffsetDateTime now = OffsetDateTime.now(clock);
        try {
            repository.insert(
                    id, workspaceId, requireName(name), description(description), actorId, now);
        } catch (DuplicateKeyException exception) {
            throw nameConflict();
        }
        authorization.invalidateWorkspace(workspaceId);
        auditService.success(workspaceId, actorId, "user-group.create", "USER_GROUP", id);
        return requireGroup(id);
    }

    @Transactional
    public UserGroupView update(UUID actorId, UUID groupId, String name, String description) {
        UserGroupView group = requireGroup(groupId);
        authorization.require(
                actorId, ResourceType.WORKSPACE, group.workspaceId(), Capability.MANAGE);
        try {
            repository.update(
                    groupId, requireName(name), description(description), OffsetDateTime.now(clock));
        } catch (DuplicateKeyException exception) {
            throw nameConflict();
        }
        auditService.success(
                group.workspaceId(), actorId, "user-group.update", "USER_GROUP", groupId);
        return requireGroup(groupId);
    }

    @Transactional
    public void delete(UUID actorId, UUID groupId) {
        UserGroupView group = requireGroup(groupId);
        authorization.require(
                actorId, ResourceType.WORKSPACE, group.workspaceId(), Capability.MANAGE);
        repository.softDelete(groupId, OffsetDateTime.now(clock));
        authorization.invalidateWorkspace(group.workspaceId());
        auditService.success(
                group.workspaceId(), actorId, "user-group.delete", "USER_GROUP", groupId);
    }

    @Transactional(readOnly = true)
    public List<UserGroupMemberView> members(UUID actorId, UUID groupId) {
        UserGroupView group = requireGroup(groupId);
        authorization.require(
                actorId, ResourceType.WORKSPACE, group.workspaceId(), Capability.READ);
        return repository.members(groupId);
    }

    @Transactional
    public List<UserGroupMemberView> addMember(
            UUID actorId, UUID groupId, UUID userId) {
        UserGroupView group = requireGroup(groupId);
        authorization.require(
                actorId, ResourceType.WORKSPACE, group.workspaceId(), Capability.MANAGE);
        if (userId == null || !repository.workspaceMember(group.workspaceId(), userId)) {
            throw new IllegalArgumentException("User group member must belong to the same workspace");
        }
        try {
            repository.addMember(
                    groupId, group.workspaceId(), userId, actorId, OffsetDateTime.now(clock));
        } catch (DuplicateKeyException exception) {
            throw new DomainConflictException(
                    "USER_GROUP_MEMBER_EXISTS", "The user is already in this group");
        } catch (DataIntegrityViolationException exception) {
            throw new IllegalArgumentException(
                    "User group member must belong to the same workspace", exception);
        }
        authorization.invalidateWorkspace(group.workspaceId());
        auditService.success(
                group.workspaceId(), actorId, "user-group.member.add", "USER_GROUP", groupId);
        return repository.members(groupId);
    }

    @Transactional
    public List<UserGroupMemberView> removeMember(
            UUID actorId, UUID groupId, UUID userId) {
        UserGroupView group = requireGroup(groupId);
        authorization.require(
                actorId, ResourceType.WORKSPACE, group.workspaceId(), Capability.MANAGE);
        repository.removeMember(groupId, userId);
        authorization.invalidateWorkspace(group.workspaceId());
        auditService.success(
                group.workspaceId(), actorId, "user-group.member.remove", "USER_GROUP", groupId);
        return repository.members(groupId);
    }

    private UserGroupView requireGroup(UUID groupId) {
        if (groupId == null) throw new IllegalArgumentException("User group id is required");
        UserGroupView group = repository.find(groupId);
        if (group == null) throw new ResourceNotFoundException();
        return group;
    }

    private static String requireName(String value) {
        if (value == null || value.trim().length() < 2 || value.trim().length() > 120) {
            throw new IllegalArgumentException(
                    "User group name must be between 2 and 120 characters");
        }
        return value.trim();
    }

    private static String description(String value) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim();
        if (normalized.length() > 2_000) {
            throw new IllegalArgumentException("User group description is too long");
        }
        return normalized;
    }

    private static DomainConflictException nameConflict() {
        return new DomainConflictException(
                "USER_GROUP_NAME_CONFLICT", "A user group with this name already exists");
    }
}
