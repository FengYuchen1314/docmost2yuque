package io.knowledge.platform.catalog;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationDecision;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import java.net.URI;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class CatalogService {

    private final CatalogRepository repository;
    private final AuthorizationService authorization;
    private final AuditService auditService;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public CatalogService(
            CatalogRepository repository,
            AuthorizationService authorization,
            AuditService auditService,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public CatalogTreeView list(UUID actorId, UUID knowledgeBaseId) {
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.READ);
        List<CatalogNodeView> visible = repository.list(knowledgeBaseId).stream()
                .filter(node -> node.pageId() == null
                        || authorization
                                .resolve(actorId, ResourceType.PAGE, node.pageId())
                                .allows(Capability.READ))
                .toList();
        return new CatalogTreeView(
                knowledgeBaseId, repository.currentRevision(knowledgeBaseId), visible);
    }

    @Transactional
    public CatalogTreeView create(UUID actorId, CreateCatalogNodeCommand command) {
        if (command == null || command.knowledgeBaseId() == null || command.nodeType() == null) {
            throw new IllegalArgumentException("Catalog node command is incomplete");
        }
        AuthorizationDecision access = authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                command.knowledgeBaseId(),
                Capability.EDIT);
        validatePayload(command);
        validateParent(command.knowledgeBaseId(), command.parentId(), null);
        if (command.nodeType() == CatalogNodeType.DOCUMENT
                && !repository.pageBelongs(command.knowledgeBaseId(), command.pageId())) {
            throw new IllegalArgumentException("Catalog page belongs to a different knowledge base");
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        long revision = nextRevision(command.knowledgeBaseId(), command.expectedRevision(), now);
        String position = allocatePosition(
                command.knowledgeBaseId(),
                command.parentId(),
                command.beforeNodeId(),
                command.afterNodeId(),
                null,
                actorId,
                now);
        CatalogNodeView node = new CatalogNodeView(
                Ids.next(),
                access.workspaceId(),
                command.knowledgeBaseId(),
                command.nodeType(),
                command.pageId(),
                command.parentId(),
                position,
                title(command.titleOverride(), command.nodeType()),
                url(command.url(), command.nodeType()),
                command.metadata() == null ? objectMapper.createObjectNode() : command.metadata(),
                actorId,
                actorId,
                now,
                now);
        try {
            repository.insert(node);
        } catch (DuplicateKeyException exception) {
            throw new DomainConflictException(
                    "CATALOG_PAGE_EXISTS", "The page is already present in this catalog");
        }
        finishMutation(access.workspaceId(), command.knowledgeBaseId(), revision, "CREATE", actorId, now);
        return list(actorId, command.knowledgeBaseId());
    }

    @Transactional
    public CatalogTreeView rename(
            UUID actorId,
            UUID nodeId,
            String title,
            long expectedRevision) {
        CatalogNodeView node = requireNode(nodeId);
        authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                node.knowledgeBaseId(),
                Capability.EDIT);
        OffsetDateTime now = OffsetDateTime.now(clock);
        long revision = nextRevision(node.knowledgeBaseId(), expectedRevision, now);
        repository.rename(nodeId, requiredTitle(title), now, actorId);
        finishMutation(
                node.workspaceId(), node.knowledgeBaseId(), revision, "RENAME", actorId, now);
        return list(actorId, node.knowledgeBaseId());
    }

    @Transactional
    public CatalogTreeView move(UUID actorId, MoveCatalogNodeCommand command) {
        if (command == null || command.nodeId() == null) {
            throw new IllegalArgumentException("Catalog node id is required");
        }
        CatalogNodeView node = requireNode(command.nodeId());
        authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                node.knowledgeBaseId(),
                Capability.EDIT);
        validateParent(node.knowledgeBaseId(), command.targetParentId(), node.id());
        OffsetDateTime now = OffsetDateTime.now(clock);
        long revision = nextRevision(node.knowledgeBaseId(), command.expectedRevision(), now);
        String position = allocatePosition(
                node.knowledgeBaseId(),
                command.targetParentId(),
                command.beforeNodeId(),
                command.afterNodeId(),
                node.id(),
                actorId,
                now);
        repository.move(node.id(), command.targetParentId(), position, now, actorId);
        finishMutation(
                node.workspaceId(), node.knowledgeBaseId(), revision, "MOVE", actorId, now);
        return list(actorId, node.knowledgeBaseId());
    }

    @Transactional
    public CatalogTreeView remove(UUID actorId, UUID nodeId, long expectedRevision) {
        CatalogNodeView node = requireNode(nodeId);
        authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                node.knowledgeBaseId(),
                Capability.EDIT);
        if (repository.hasChildren(nodeId)) {
            throw new DomainConflictException(
                    "CATALOG_NODE_HAS_CHILDREN",
                    "Move or remove child nodes before removing this catalog node");
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        long revision = nextRevision(node.knowledgeBaseId(), expectedRevision, now);
        repository.remove(nodeId, now, actorId);
        finishMutation(
                node.workspaceId(), node.knowledgeBaseId(), revision, "REMOVE", actorId, now);
        return list(actorId, node.knowledgeBaseId());
    }

    @Transactional
    public CatalogTreeView batch(
            UUID actorId,
            UUID knowledgeBaseId,
            List<UUID> nodeIds,
            String operation,
            UUID targetParentId,
            long expectedRevision) {
        if (knowledgeBaseId == null || nodeIds == null || nodeIds.isEmpty()) {
            throw new IllegalArgumentException("At least one catalog node is required");
        }
        LinkedHashSet<UUID> selected = new LinkedHashSet<>(nodeIds);
        if (selected.contains(null) || selected.size() > 500) {
            throw new IllegalArgumentException("Catalog batch accepts between 1 and 500 unique nodes");
        }
        String normalizedOperation = operation == null ? "" : operation.trim().toUpperCase();
        if (!Set.of("MOVE", "REMOVE").contains(normalizedOperation)) {
            throw new IllegalArgumentException("Catalog batch operation is invalid");
        }
        if ("REMOVE".equals(normalizedOperation) && targetParentId != null) {
            throw new IllegalArgumentException("Catalog removal does not accept a target parent");
        }
        AuthorizationDecision access = authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.EDIT);
        List<CatalogNodeView> allNodes = repository.list(knowledgeBaseId);
        Map<UUID, CatalogNodeView> byId = new HashMap<>();
        allNodes.forEach(node -> byId.put(node.id(), node));
        if (!byId.keySet().containsAll(selected)) {
            throw new ResourceNotFoundException();
        }
        List<UUID> roots = selected.stream()
                .filter(nodeId -> !hasSelectedAncestor(byId.get(nodeId), selected, byId))
                .toList();
        OffsetDateTime now = OffsetDateTime.now(clock);
        if ("MOVE".equals(normalizedOperation)) {
            if (targetParentId != null) {
                CatalogNodeView parent = byId.get(targetParentId);
                if (parent == null) throw new ResourceNotFoundException();
                if (parent.nodeType() != CatalogNodeType.GROUP) {
                    throw new IllegalArgumentException("Catalog parent must be a group");
                }
            }
            for (UUID rootId : roots) {
                validateParent(knowledgeBaseId, targetParentId, rootId);
            }
            long revision = nextRevision(knowledgeBaseId, expectedRevision, now);
            for (UUID rootId : roots) {
                String position = allocatePosition(
                        knowledgeBaseId, targetParentId, null, null, rootId, actorId, now);
                repository.move(rootId, targetParentId, position, now, actorId);
            }
            finishMutation(
                    access.workspaceId(), knowledgeBaseId, revision, "BATCH_MOVE", actorId, now);
        } else {
            Set<UUID> removal = new LinkedHashSet<>(selected);
            boolean changed;
            do {
                changed = false;
                for (CatalogNodeView node : allNodes) {
                    if (node.parentId() != null
                            && removal.contains(node.parentId())
                            && removal.add(node.id())) {
                        changed = true;
                    }
                }
            } while (changed);
            long revision = nextRevision(knowledgeBaseId, expectedRevision, now);
            repository.removeAll(removal, now, actorId);
            finishMutation(
                    access.workspaceId(), knowledgeBaseId, revision, "BATCH_REMOVE", actorId, now);
        }
        return list(actorId, knowledgeBaseId);
    }

    @Transactional(readOnly = true)
    public List<CatalogRevisionView> history(
            UUID actorId,
            UUID knowledgeBaseId,
            int limit) {
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.MANAGE);
        return repository.revisions(knowledgeBaseId, limit, 0);
    }

    @Transactional(readOnly = true)
    public CatalogRevisionPageView historyPage(
            UUID actorId,
            UUID knowledgeBaseId,
            int limit,
            int offset) {
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.MANAGE);
        int count = Math.max(1, Math.min(limit, 50));
        int start = Math.max(0, Math.min(offset, 1_000_000));
        List<CatalogRevisionView> rows = repository.revisions(
                knowledgeBaseId, count + 1, start);
        boolean hasMore = rows.size() > count;
        List<CatalogRevisionView> items = List.copyOf(
                rows.subList(0, Math.min(rows.size(), count)));
        return new CatalogRevisionPageView(items, start + items.size(), hasMore);
    }

    @Transactional
    public CatalogTreeView restore(
            UUID actorId,
            UUID knowledgeBaseId,
            long revisionNo,
            long expectedRevision) {
        AuthorizationDecision access = authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.MANAGE);
        CatalogRevisionView target = repository.revision(knowledgeBaseId, revisionNo);
        if (target == null) throw new ResourceNotFoundException();
        List<CatalogNodeView> nodes = parseSnapshot(
                target.snapshot(), access.workspaceId(), knowledgeBaseId, actorId);
        OffsetDateTime now = OffsetDateTime.now(clock);
        long revision = nextRevision(knowledgeBaseId, expectedRevision, now);
        repository.restore(access.workspaceId(), knowledgeBaseId, nodes, actorId, now);
        finishMutation(
                access.workspaceId(), knowledgeBaseId, revision, "RESTORE", actorId, now);
        return list(actorId, knowledgeBaseId);
    }

    private List<CatalogNodeView> parseSnapshot(
            JsonNode snapshot,
            UUID workspaceId,
            UUID knowledgeBaseId,
            UUID actorId) {
        if (snapshot == null || !snapshot.isArray() || snapshot.size() > 20_000) {
            throw new DomainConflictException(
                    "CATALOG_SNAPSHOT_INVALID", "The selected catalog snapshot is invalid");
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        Map<UUID, CatalogNodeView> nodes = new HashMap<>();
        try {
            for (JsonNode item : snapshot) {
                UUID id = UUID.fromString(requiredString(item.get("id")));
                CatalogNodeType type = CatalogNodeType.valueOf(requiredString(item.get("nodeType")));
                UUID pageId = nullableUuid(item.get("pageId"));
                UUID parentId = nullableUuid(item.get("parentId"));
                String position = requiredString(item.get("position"));
                if (!position.matches("[0-9]{39}")) {
                    throw new IllegalArgumentException("Catalog position is invalid");
                }
                String title = item.path("titleOverride").isNull()
                        || item.path("titleOverride").isMissingNode()
                        ? null
                        : item.path("titleOverride").stringValue();
                String link = item.path("url").isNull() || item.path("url").isMissingNode()
                        ? null
                        : item.path("url").stringValue();
                JsonNode metadata = item.path("metadata");
                if (!metadata.isObject()) metadata = objectMapper.createObjectNode();
                switch (type) {
                    case DOCUMENT -> {
                        if (pageId == null || link != null
                                || !repository.pageBelongs(knowledgeBaseId, pageId)) {
                            throw new DomainConflictException(
                                    "CATALOG_SNAPSHOT_PAGE_MISSING",
                                    "A document in this catalog version is no longer available");
                        }
                        if (title != null) title = requiredTitle(title);
                    }
                    case GROUP -> {
                        if (pageId != null || link != null) throw new IllegalArgumentException();
                        title = requiredTitle(title);
                    }
                    case LINK -> {
                        if (pageId != null || link == null) throw new IllegalArgumentException();
                        title = requiredTitle(title);
                        link = url(link, type);
                    }
                }
                CatalogNodeView node = new CatalogNodeView(
                        id, workspaceId, knowledgeBaseId, type, pageId, parentId, position,
                        title, link, metadata, actorId, actorId, now, now);
                if (nodes.put(id, node) != null) throw new IllegalArgumentException();
            }
            for (CatalogNodeView node : nodes.values()) {
                if (node.parentId() != null && !nodes.containsKey(node.parentId())) {
                    throw new IllegalArgumentException("Catalog parent is missing");
                }
                Set<UUID> path = new HashSet<>();
                CatalogNodeView cursor = node;
                while (cursor.parentId() != null) {
                    if (!path.add(cursor.id())) throw new IllegalArgumentException("Catalog cycle");
                    cursor = nodes.get(cursor.parentId());
                }
            }
        } catch (DomainConflictException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new DomainConflictException(
                    "CATALOG_SNAPSHOT_INVALID", "The selected catalog snapshot is invalid");
        }
        return List.copyOf(nodes.values());
    }

    private static UUID nullableUuid(JsonNode value) {
        String text = value == null || value.isNull() ? null : value.stringValue();
        return text == null || text.isBlank() ? null : UUID.fromString(text);
    }

    private static String requiredString(JsonNode value) {
        String text = value == null || value.isNull() ? null : value.stringValue();
        if (text == null || text.isBlank()) throw new IllegalArgumentException();
        return text;
    }

    private String allocatePosition(
            UUID knowledgeBaseId,
            UUID parentId,
            UUID beforeNodeId,
            UUID afterNodeId,
            UUID excludedNodeId,
            UUID actorId,
            OffsetDateTime now) {
        if (beforeNodeId != null && afterNodeId != null) {
            throw new IllegalArgumentException("Use either beforeNodeId or afterNodeId, not both");
        }
        List<CatalogRepository.Sibling> siblings =
                repository.siblingsForUpdate(knowledgeBaseId, parentId, excludedNodeId);
        String rank = rankFor(siblings, beforeNodeId, afterNodeId);
        if (rank != null) {
            return rank;
        }
        repository.rebalance(siblings, now, actorId);
        List<CatalogRepository.Sibling> reloaded =
                repository.siblingsForUpdate(knowledgeBaseId, parentId, excludedNodeId);
        rank = rankFor(reloaded, beforeNodeId, afterNodeId);
        if (rank == null) {
            throw new DomainConflictException(
                    "CATALOG_RANK_EXHAUSTED", "Catalog ordering space is exhausted");
        }
        return rank;
    }

    private static String rankFor(
            List<CatalogRepository.Sibling> siblings,
            UUID beforeNodeId,
            UUID afterNodeId) {
        if (beforeNodeId == null && afterNodeId == null) {
            String lower = siblings.isEmpty()
                    ? null
                    : siblings.get(siblings.size() - 1).position();
            return CatalogRank.between(lower, null);
        }
        UUID anchor = beforeNodeId == null ? afterNodeId : beforeNodeId;
        int index = -1;
        for (int candidate = 0; candidate < siblings.size(); candidate++) {
            if (siblings.get(candidate).id().equals(anchor)) {
                index = candidate;
                break;
            }
        }
        if (index < 0) {
            throw new IllegalArgumentException("Catalog ordering anchor is not a target sibling");
        }
        if (beforeNodeId != null) {
            String lower = index == 0 ? null : siblings.get(index - 1).position();
            return CatalogRank.between(lower, siblings.get(index).position());
        }
        String upper = index + 1 == siblings.size()
                ? null
                : siblings.get(index + 1).position();
        return CatalogRank.between(siblings.get(index).position(), upper);
    }

    private void validateParent(UUID knowledgeBaseId, UUID parentId, UUID movingNodeId) {
        if (parentId == null) {
            return;
        }
        CatalogNodeView parent = requireNode(parentId);
        if (!knowledgeBaseId.equals(parent.knowledgeBaseId())) {
            throw new IllegalArgumentException("Catalog parent belongs to a different knowledge base");
        }
        if (movingNodeId != null
                && (movingNodeId.equals(parentId)
                        || repository.isDescendant(movingNodeId, parentId))) {
            throw new DomainConflictException(
                    "CATALOG_CYCLE", "A catalog node cannot be moved below itself or its descendant");
        }
        if (parent.nodeType() != CatalogNodeType.GROUP) {
            throw new IllegalArgumentException("Catalog parent must be a group");
        }
    }

    private static boolean hasSelectedAncestor(
            CatalogNodeView node,
            Set<UUID> selected,
            Map<UUID, CatalogNodeView> byId) {
        UUID parentId = node.parentId();
        Set<UUID> visited = new HashSet<>();
        while (parentId != null && visited.add(parentId)) {
            if (selected.contains(parentId)) return true;
            CatalogNodeView parent = byId.get(parentId);
            parentId = parent == null ? null : parent.parentId();
        }
        return false;
    }

    private static void validatePayload(CreateCatalogNodeCommand command) {
        switch (command.nodeType()) {
            case DOCUMENT -> {
                if (command.pageId() == null || command.url() != null) {
                    throw new IllegalArgumentException("Document catalog node requires only pageId");
                }
            }
            case LINK -> {
                if (command.pageId() != null || command.url() == null) {
                    throw new IllegalArgumentException("Link catalog node requires only url");
                }
            }
            case GROUP -> {
                if (command.pageId() != null || command.url() != null) {
                    throw new IllegalArgumentException("Group catalog node has no page or url");
                }
            }
        }
    }

    private long nextRevision(UUID knowledgeBaseId, long expectedRevision, OffsetDateTime now) {
        if (expectedRevision < 0) {
            throw new IllegalArgumentException("Expected catalog revision is required");
        }
        long revision = repository.incrementRevision(knowledgeBaseId, expectedRevision, now);
        if (revision < 0) {
            throw new DomainConflictException(
                    "CATALOG_REVISION_CONFLICT",
                    "The catalog changed since it was loaded; reload and apply the operation again");
        }
        return revision;
    }

    private void finishMutation(
            UUID workspaceId,
            UUID knowledgeBaseId,
            long revision,
            String operation,
            UUID actorId,
            OffsetDateTime now) {
        repository.insertRevision(
                workspaceId, knowledgeBaseId, revision, operation, actorId, now);
        auditService.success(
                workspaceId, actorId, "catalog." + operation.toLowerCase(), "KNOWLEDGE_BASE", knowledgeBaseId);
    }

    private CatalogNodeView requireNode(UUID nodeId) {
        CatalogNodeView node = repository.find(nodeId);
        if (node == null) {
            throw new ResourceNotFoundException();
        }
        return node;
    }

    private static String title(String value, CatalogNodeType type) {
        if (value == null || value.isBlank()) {
            if (type == CatalogNodeType.DOCUMENT) {
                return null;
            }
            throw new IllegalArgumentException("Catalog group or link title is required");
        }
        return requiredTitle(value);
    }

    private static String requiredTitle(String value) {
        if (value == null || value.trim().isEmpty() || value.trim().length() > 500) {
            throw new IllegalArgumentException(
                    "Catalog title must be between 1 and 500 characters");
        }
        return value.trim();
    }

    static String url(String value, CatalogNodeType type) {
        if (type != CatalogNodeType.LINK) {
            return null;
        }
        try {
            if (value == null || value.length() > 2_000) {
                throw new IllegalArgumentException("Catalog link URL is invalid");
            }
            URI uri = URI.create(value.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme())
                    || uri.getHost() == null
                    || uri.getUserInfo() != null) {
                throw new IllegalArgumentException("Catalog link URL is invalid");
            }
            return uri.toASCIIString();
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("Catalog link URL is invalid");
        }
    }
}
