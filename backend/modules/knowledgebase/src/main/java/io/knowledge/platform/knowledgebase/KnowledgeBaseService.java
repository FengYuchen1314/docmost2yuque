package io.knowledge.platform.knowledgebase;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationDecision;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.search.SearchDocumentCommand;
import io.knowledge.platform.search.SearchIndexWriter;
import java.net.URI;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.jooq.exception.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

@Service
public class KnowledgeBaseService {

    private static final Pattern SLUG =
            Pattern.compile("[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*");
    private final KnowledgeBaseRepository repository;
    private final AuthorizationService authorization;
    private final AuditService auditService;
    private final SearchIndexWriter searchIndex;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public KnowledgeBaseService(
            KnowledgeBaseRepository repository,
            AuthorizationService authorization,
            AuditService auditService,
            SearchIndexWriter searchIndex,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.auditService = auditService;
        this.searchIndex = searchIndex;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional
    public KnowledgeBaseView create(UUID actorId, CreateKnowledgeBaseCommand command) {
        if (command == null || command.workspaceId() == null) {
            throw new IllegalArgumentException("Workspace id is required");
        }
        authorization.require(
                actorId, ResourceType.WORKSPACE, command.workspaceId(), Capability.READ);
        Owner owner = validateOwner(
                actorId,
                command.workspaceId(),
                command.ownerType(),
                command.ownerId(),
                true);
        OffsetDateTime now = OffsetDateTime.now(clock);
        KnowledgeBaseView value = new KnowledgeBaseView(
                Ids.next(),
                command.workspaceId(),
                requireName(command.name()),
                requireSlug(command.slug()),
                text(command.description(), 8_000, "Knowledge base description"),
                text(command.icon(), 2_000, "Knowledge base icon"),
                owner.type(),
                owner.id(),
                owner.teamId(),
                null,
                visibility(command.visibility()),
                Boolean.TRUE.equals(command.allowPublicIndex()),
                publishMode(command.publishMode()),
                "{}",
                "{}",
                "{}",
                0,
                actorId,
                now,
                now);
        try {
            repository.insert(value);
            repository.upsertMember(value.id(), actorId, "MANAGER", now);
        } catch (DuplicateKeyException exception) {
            throw new DomainConflictException(
                    "KNOWLEDGE_BASE_SLUG_CONFLICT",
                    "Knowledge base slug is already in use");
        }
        authorization.invalidateWorkspace(value.workspaceId());
        index(actorId, value);
        auditService.success(
                value.workspaceId(), actorId, "knowledge-base.create", "KNOWLEDGE_BASE", value.id());
        return value;
    }

    @Transactional(readOnly = true)
    public List<KnowledgeBaseView> list(UUID actorId, UUID workspaceId) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.READ);
        return repository.list(workspaceId).stream()
                .filter(value -> authorization
                        .resolve(actorId, ResourceType.KNOWLEDGE_BASE, value.id())
                        .allows(Capability.READ))
                .toList();
    }

    @Transactional(readOnly = true)
    public KnowledgeBaseView get(UUID actorId, UUID knowledgeBaseId) {
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.READ);
        return requireKnowledgeBase(knowledgeBaseId);
    }

    @Transactional
    public KnowledgeBaseView update(UUID actorId, UpdateKnowledgeBaseCommand command) {
        if (command == null || command.knowledgeBaseId() == null) {
            throw new IllegalArgumentException("Knowledge base id is required");
        }
        authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                command.knowledgeBaseId(),
                Capability.MANAGE);
        KnowledgeBaseView current = requireKnowledgeBase(command.knowledgeBaseId());
        UUID homepageId = command.homepagePageId();
        if (homepageId != null && !repository.pageBelongs(current.id(), homepageId)) {
            throw new IllegalArgumentException(
                    "Homepage must be an active page in the same knowledge base");
        }
        KnowledgeBaseView updated = new KnowledgeBaseView(
                current.id(),
                current.workspaceId(),
                requireName(command.name()),
                requireSlug(command.slug()),
                text(command.description(), 8_000, "Knowledge base description"),
                text(command.icon(), 2_000, "Knowledge base icon"),
                current.ownerType(),
                current.ownerId(),
                current.teamId(),
                homepageId,
                visibility(command.visibility()),
                Boolean.TRUE.equals(command.allowPublicIndex()),
                publishMode(command.publishMode()),
                configJson(objectMapper, command.watermarkConfig(), "Watermark", false),
                configJson(objectMapper, command.appearanceConfig(), "Appearance", true),
                configJson(objectMapper, command.catalogConfig(), "Catalog", false),
                current.catalogRevision(),
                current.createdBy(),
                current.createdAt(),
                OffsetDateTime.now(clock));
        try {
            repository.update(updated);
        } catch (DuplicateKeyException exception) {
            throw new DomainConflictException(
                    "KNOWLEDGE_BASE_SLUG_CONFLICT",
                    "Knowledge base slug is already in use");
        } catch (DataAccessException exception) {
            throw new IllegalArgumentException("Knowledge base JSON settings are invalid");
        }
        authorization.invalidateWorkspace(updated.workspaceId());
        index(actorId, updated);
        auditService.success(
                updated.workspaceId(),
                actorId,
                "knowledge-base.update",
                "KNOWLEDGE_BASE",
                updated.id());
        return updated;
    }

    @Transactional
    public KnowledgeBaseView transfer(UUID actorId, TransferKnowledgeBaseCommand command) {
        if (command == null || command.knowledgeBaseId() == null) {
            throw new IllegalArgumentException("Knowledge base id is required");
        }
        AuthorizationDecision currentAccess = authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                command.knowledgeBaseId(),
                Capability.MANAGE);
        KnowledgeBaseView current = requireKnowledgeBase(command.knowledgeBaseId());
        Owner owner = validateOwner(
                actorId,
                currentAccess.workspaceId(),
                command.ownerType(),
                command.ownerId(),
                true);
        repository.transfer(
                current.id(),
                owner.type(),
                owner.id(),
                owner.teamId(),
                OffsetDateTime.now(clock));
        authorization.invalidateWorkspace(current.workspaceId());
        auditService.success(
                current.workspaceId(),
                actorId,
                "knowledge-base.transfer",
                "KNOWLEDGE_BASE",
                current.id());
        KnowledgeBaseView transferred = requireKnowledgeBase(current.id());
        index(actorId, transferred);
        return transferred;
    }

    @Transactional
    public void archive(UUID actorId, UUID knowledgeBaseId) {
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.DELETE);
        KnowledgeBaseView current = requireKnowledgeBase(knowledgeBaseId);
        repository.archive(knowledgeBaseId, OffsetDateTime.now(clock));
        searchIndex.deleteKnowledgeBase(knowledgeBaseId);
        authorization.invalidateWorkspace(current.workspaceId());
        auditService.success(
                current.workspaceId(),
                actorId,
                "knowledge-base.archive",
                "KNOWLEDGE_BASE",
                current.id());
    }

    @Transactional(readOnly = true)
    public List<KnowledgeBaseMemberView> members(UUID actorId, UUID knowledgeBaseId) {
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.READ);
        return repository.members(knowledgeBaseId);
    }

    @Transactional
    public List<KnowledgeBaseMemberView> upsertMember(
            UUID actorId,
            UUID knowledgeBaseId,
            UUID userId,
            String role) {
        authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                knowledgeBaseId,
                Capability.MANAGE_PERMISSIONS);
        KnowledgeBaseView knowledgeBase = requireKnowledgeBase(knowledgeBaseId);
        if (!repository.workspaceMember(knowledgeBase.workspaceId(), userId)) {
            throw new IllegalArgumentException(
                    "Knowledge base member must belong to the same workspace");
        }
        repository.upsertMember(
                knowledgeBaseId, userId, memberRole(role), OffsetDateTime.now(clock));
        authorization.invalidateWorkspace(knowledgeBase.workspaceId());
        auditService.success(
                knowledgeBase.workspaceId(),
                actorId,
                "knowledge-base.member.upsert",
                "KNOWLEDGE_BASE",
                knowledgeBaseId);
        return repository.members(knowledgeBaseId);
    }

    @Transactional
    public void removeMember(UUID actorId, UUID knowledgeBaseId, UUID userId) {
        authorization.require(
                actorId,
                ResourceType.KNOWLEDGE_BASE,
                knowledgeBaseId,
                Capability.MANAGE_PERMISSIONS);
        KnowledgeBaseView knowledgeBase = requireKnowledgeBase(knowledgeBaseId);
        if (knowledgeBase.createdBy().equals(userId)) {
            throw new DomainConflictException(
                    "KNOWLEDGE_BASE_CREATOR_MANAGER",
                    "Transfer ownership before removing the creator's manager membership");
        }
        repository.removeMember(knowledgeBaseId, userId);
        authorization.invalidateWorkspace(knowledgeBase.workspaceId());
        auditService.success(
                knowledgeBase.workspaceId(),
                actorId,
                "knowledge-base.member.remove",
                "KNOWLEDGE_BASE",
                knowledgeBaseId);
    }

    private Owner validateOwner(
            UUID actorId,
            UUID workspaceId,
            String ownerType,
            UUID ownerId,
            boolean requireManagement) {
        if (ownerType == null || ownerId == null) {
            throw new IllegalArgumentException("Knowledge base owner is required");
        }
        String type = ownerType.toUpperCase(Locale.ROOT);
        return switch (type) {
            case "PERSONAL" -> {
                if (!actorId.equals(ownerId)) {
                    throw new IllegalArgumentException(
                            "A personal knowledge base can only be created or transferred to yourself");
                }
                yield new Owner(type, ownerId, null);
            }
            case "TEAM" -> {
                AuthorizationDecision team = authorization.require(
                        actorId,
                        ResourceType.TEAM,
                        ownerId,
                        requireManagement ? Capability.MANAGE : Capability.READ);
                if (!workspaceId.equals(team.workspaceId())) {
                    throw new IllegalArgumentException("Team belongs to a different workspace");
                }
                yield new Owner(type, ownerId, ownerId);
            }
            case "WORKSPACE" -> {
                if (!workspaceId.equals(ownerId)) {
                    throw new IllegalArgumentException("Workspace owner id is invalid");
                }
                authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.MANAGE);
                yield new Owner(type, ownerId, null);
            }
            default -> throw new IllegalArgumentException("Knowledge base owner type is invalid");
        };
    }

    private KnowledgeBaseView requireKnowledgeBase(UUID id) {
        KnowledgeBaseView value = repository.find(id);
        if (value == null) {
            throw new ResourceNotFoundException();
        }
        return value;
    }

    private void index(UUID actorId, KnowledgeBaseView value) {
        AuthorizationDecision decision = authorization.resolve(
                actorId, ResourceType.KNOWLEDGE_BASE, value.id());
        var metadata = tools.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        metadata.put("ownerType", value.ownerType());
        metadata.put("ownerId", value.ownerId().toString());
        metadata.put("allowPublicIndex", value.allowPublicIndex());
        if (value.icon() != null) metadata.put("icon", value.icon());
        searchIndex.upsert(new SearchDocumentCommand(
                value.id(), value.workspaceId(), "KNOWLEDGE_BASE", value.id(), "CANONICAL",
                value.name(), value.description(), List.of(), value.slug(), value.createdBy(), null,
                value.visibility(), null, decision.permissionVersion(), metadata,
                value.createdAt(), value.updatedAt()));
    }

    private static String requireName(String value) {
        if (value == null || value.trim().length() < 1 || value.trim().length() > 160) {
            throw new IllegalArgumentException(
                    "Knowledge base name must be between 1 and 160 characters");
        }
        return value.trim();
    }

    private static String requireSlug(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Knowledge base slug is required");
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if (normalized.length() < 1
                || normalized.length() > 100
                || !SLUG.matcher(normalized).matches()) {
            throw new IllegalArgumentException("Knowledge base slug is invalid");
        }
        return normalized;
    }

    private static String visibility(String value) {
        String normalized = value == null ? "PRIVATE" : value.toUpperCase(Locale.ROOT);
        if (!Set.of("PRIVATE", "WORKSPACE", "PUBLIC").contains(normalized)) {
            throw new IllegalArgumentException("Knowledge base visibility is invalid");
        }
        return normalized;
    }

    private static String publishMode(String value) {
        String normalized = value == null ? "MANUAL" : value.toUpperCase(Locale.ROOT);
        if (!Set.of("MANUAL", "AUTO").contains(normalized)) {
            throw new IllegalArgumentException("Knowledge base publish mode is invalid");
        }
        return normalized;
    }

    private static String memberRole(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Knowledge base member role is required");
        }
        String normalized = value.toUpperCase(Locale.ROOT);
        if (!Set.of("MANAGER", "EDITOR", "READER").contains(normalized)) {
            throw new IllegalArgumentException("Knowledge base member role is invalid");
        }
        return normalized;
    }

    private static String text(String value, int max, String label) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = value.trim();
        if (normalized.length() > max) {
            throw new IllegalArgumentException(label + " is too long");
        }
        return normalized;
    }

    static String configJson(
            ObjectMapper objectMapper, String value, String label, boolean validateCover) {
        if (value == null || value.isBlank()) return "{}";
        if (value.length() > 100_000) {
            throw new IllegalArgumentException(label + " config is too large");
        }
        try {
            JsonNode parsed = objectMapper.readTree(value);
            if (!parsed.isObject()) {
                throw new IllegalArgumentException(label + " config must be a JSON object");
            }
            if (validateCover && parsed.has("coverUrl") && !parsed.path("coverUrl").isNull()) {
                if (!parsed.path("coverUrl").isString()) {
                    throw new IllegalArgumentException("Appearance cover URL is invalid");
                }
                String cover = parsed.path("coverUrl").stringValue().trim();
                if (!cover.isEmpty()) {
                    URI uri = URI.create(cover);
                    if (cover.length() > 2_000
                            || !"https".equalsIgnoreCase(uri.getScheme())
                            || uri.getHost() == null
                            || uri.getUserInfo() != null) {
                        throw new IllegalArgumentException("Appearance cover URL is invalid");
                    }
                    ((ObjectNode) parsed).put("coverUrl", uri.toASCIIString());
                }
            }
            return objectMapper.writeValueAsString(parsed);
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException(label + " config is invalid");
        }
    }

    private record Owner(String type, UUID id, UUID teamId) {}
}
