package io.knowledge.platform.engagement;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class KnowledgeBaseGroupService {

    private final KnowledgeBaseGroupRepository repository;
    private final AuthorizationService authorization;
    private final AuditService auditService;
    private final Clock clock;

    public KnowledgeBaseGroupService(
            KnowledgeBaseGroupRepository repository,
            AuthorizationService authorization,
            AuditService auditService,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<KnowledgeBaseGroupView> list(UUID actorId, UUID workspaceId) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.READ);
        return repository.list(actorId, workspaceId).stream()
                .map(group -> new KnowledgeBaseGroupView(
                        group.id(), group.workspaceId(), group.name(), group.position(),
                        group.items().stream()
                                .filter(item -> authorization
                                        .resolve(actorId, ResourceType.KNOWLEDGE_BASE, item.knowledgeBaseId())
                                        .allows(Capability.READ))
                                .toList(),
                        group.createdAt(), group.updatedAt()))
                .toList();
    }

    @Transactional
    public KnowledgeBaseGroupView create(UUID actorId, UUID workspaceId, String name) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.READ);
        UUID id = Ids.next();
        OffsetDateTime now = OffsetDateTime.now(clock);
        try {
            repository.insertGroup(
                    id, workspaceId, actorId, groupName(name),
                    repository.nextGroupPosition(actorId, workspaceId), now);
        } catch (DuplicateKeyException exception) {
            throw nameConflict();
        }
        auditService.success(workspaceId, actorId, "knowledge-base-group.create", "KB_GROUP", id);
        return requireGroup(actorId, id);
    }

    @Transactional
    public KnowledgeBaseGroupView rename(UUID actorId, UUID groupId, String name) {
        KnowledgeBaseGroupView current = requireGroup(actorId, groupId);
        try {
            if (!repository.rename(groupId, actorId, groupName(name), OffsetDateTime.now(clock))) {
                throw new ResourceNotFoundException();
            }
        } catch (DuplicateKeyException exception) {
            throw nameConflict();
        }
        auditService.success(
                current.workspaceId(), actorId, "knowledge-base-group.rename", "KB_GROUP", groupId);
        return requireGroup(actorId, groupId);
    }

    @Transactional
    public void delete(UUID actorId, UUID groupId) {
        KnowledgeBaseGroupView current = requireGroup(actorId, groupId);
        if (!repository.delete(groupId, actorId)) throw new ResourceNotFoundException();
        auditService.success(
                current.workspaceId(), actorId, "knowledge-base-group.delete", "KB_GROUP", groupId);
    }

    @Transactional
    public List<KnowledgeBaseGroupView> reorder(
            UUID actorId, UUID workspaceId, List<UUID> orderedGroupIds) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.READ);
        requireExactOrder(
                repository.groupIds(actorId, workspaceId), orderedGroupIds,
                "Group order must contain every group exactly once");
        repository.reorderGroups(actorId, workspaceId, orderedGroupIds, OffsetDateTime.now(clock));
        return list(actorId, workspaceId);
    }

    @Transactional
    public KnowledgeBaseGroupView moveKnowledgeBase(
            UUID actorId, UUID groupId, UUID knowledgeBaseId) {
        KnowledgeBaseGroupView group = requireGroup(actorId, groupId);
        var access = authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.READ);
        if (!group.workspaceId().equals(access.workspaceId())) {
            throw new IllegalArgumentException("Knowledge base belongs to a different workspace");
        }
        repository.moveItem(
                actorId, groupId, knowledgeBaseId,
                repository.nextItemPosition(groupId), OffsetDateTime.now(clock));
        auditService.success(
                group.workspaceId(), actorId, "knowledge-base-group.move-item",
                "KNOWLEDGE_BASE", knowledgeBaseId);
        return requireGroup(actorId, groupId);
    }

    @Transactional
    public void removeKnowledgeBase(UUID actorId, UUID knowledgeBaseId) {
        repository.removeItem(actorId, knowledgeBaseId);
    }

    @Transactional
    public KnowledgeBaseGroupView reorderKnowledgeBases(
            UUID actorId, UUID groupId, List<UUID> orderedKnowledgeBaseIds) {
        KnowledgeBaseGroupView group = requireGroup(actorId, groupId);
        requireExactOrder(
                repository.itemIds(actorId, groupId), orderedKnowledgeBaseIds,
                "Knowledge base order must contain every item in the group exactly once");
        repository.reorderItems(actorId, groupId, orderedKnowledgeBaseIds);
        auditService.success(
                group.workspaceId(), actorId, "knowledge-base-group.reorder-items",
                "KB_GROUP", groupId);
        return requireGroup(actorId, groupId);
    }

    private KnowledgeBaseGroupView requireGroup(UUID actorId, UUID groupId) {
        if (groupId == null) throw new IllegalArgumentException("Knowledge base group id is required");
        KnowledgeBaseGroupView group = repository.find(groupId, actorId);
        if (group == null) throw new ResourceNotFoundException();
        return group;
    }

    private static void requireExactOrder(
            List<UUID> current, List<UUID> requested, String message) {
        if (requested == null
                || requested.size() != current.size()
                || new HashSet<>(requested).size() != requested.size()
                || !new HashSet<>(requested).equals(new HashSet<>(current))) {
            throw new IllegalArgumentException(message);
        }
    }

    private static String groupName(String value) {
        if (value == null || value.trim().isEmpty() || value.trim().length() > 100) {
            throw new IllegalArgumentException(
                    "Knowledge base group name must be between 1 and 100 characters");
        }
        return value.trim();
    }

    private static DomainConflictException nameConflict() {
        return new DomainConflictException(
                "KNOWLEDGE_BASE_GROUP_NAME_CONFLICT",
                "A knowledge base group with this name already exists");
    }
}
