package io.knowledge.platform.engagement;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationDecision;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.Ids;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class CommentService {

    private final EngagementRepository repository;
    private final AuthorizationService authorization;
    private final NotificationService notifications;
    private final ActivityService activities;
    private final AuditService auditService;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public CommentService(
            EngagementRepository repository,
            AuthorizationService authorization,
            NotificationService notifications,
            ActivityService activities,
            AuditService auditService,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.notifications = notifications;
        this.activities = activities;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<CommentView> list(UUID actorId, UUID pageId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        return repository.comments(pageId);
    }

    @Transactional(readOnly = true)
    public CommentPageView page(UUID actorId, UUID pageId, int limit, int offset) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        return page(pageId, limit, offset);
    }

    /**
     * Lists comments after a share policy has already been validated by the share module.
     * Keeping this entry point separate prevents a public share from being converted into a
     * permanent PAGE ACL for an external visitor.
     */
    @Transactional(readOnly = true)
    public List<CommentView> listViaShare(UUID pageId) {
        return repository.comments(pageId);
    }

    @Transactional(readOnly = true)
    public CommentPageView pageViaShare(UUID pageId, int limit, int offset) {
        return page(pageId, limit, offset);
    }

    @Transactional
    public CommentView create(
            UUID actorId,
            UUID pageId,
            UUID parentId,
            JsonNode anchor,
            JsonNode body,
            String plainText,
            Set<UUID> mentionedUserIds) {
        AuthorizationDecision decision =
                authorization.require(actorId, ResourceType.PAGE, pageId, Capability.COMMENT);
        validateBody(body, plainText);
        CommentView parent = null;
        if (parentId != null) {
            parent = repository.findComment(parentId);
            if (parent == null || !parent.pageId().equals(pageId)) {
                throw new IllegalArgumentException("Comment parent is invalid");
            }
        }
        UUID id = Ids.next();
        OffsetDateTime now = OffsetDateTime.now(clock);
        JsonNode safeAnchor = anchor == null ? objectMapper.createObjectNode() : anchor;
        repository.insertComment(
                id, decision.workspaceId(), pageId, parentId, safeAnchor,
                body, plainText.trim(), actorId, now);
        activities.recordPageComment(decision.workspaceId(), actorId, pageId);
        JsonNode payload = objectMapper.createObjectNode()
                .put("commentId", id.toString())
                .put("preview", abbreviate(plainText.trim(), 160));
        if (parent != null) {
            notifications.notify(
                    parent.createdBy(), decision.workspaceId(), "COMMENT_REPLY", actorId,
                    "PAGE", pageId, safeAnchor, payload,
                    "comment-reply:" + parent.id() + ":" + parent.createdBy());
        }
        for (UUID recipient : mentionedUserIds == null ? Set.<UUID>of() : mentionedUserIds) {
            if (!repository.workspaceMember(decision.workspaceId(), recipient)) {
                throw new IllegalArgumentException("Mentioned user is not in this workspace");
            }
            notifications.notify(
                    recipient, decision.workspaceId(), "COMMENT_MENTION", actorId,
                    "PAGE", pageId, safeAnchor, payload, "comment-mention:" + pageId + ":" + recipient);
        }
        auditService.success(
                decision.workspaceId(), actorId, "comment.create", "COMMENT", id);
        return requireComment(id);
    }

    /** Creates a comment for an authenticated visitor holding a valid commenter share. */
    @Transactional
    public CommentView createViaShare(
            UUID actorId,
            UUID workspaceId,
            UUID pageId,
            UUID parentId,
            JsonNode anchor,
            JsonNode body,
            String plainText) {
        if (actorId == null || workspaceId == null || pageId == null) {
            throw new IllegalArgumentException("Share comment context is required");
        }
        validateBody(body, plainText);
        CommentView parent = null;
        if (parentId != null) {
            parent = repository.findComment(parentId);
            if (parent == null || !parent.pageId().equals(pageId)) {
                throw new IllegalArgumentException("Comment parent is invalid");
            }
        }
        UUID id = Ids.next();
        OffsetDateTime now = OffsetDateTime.now(clock);
        JsonNode safeAnchor = anchor == null ? objectMapper.createObjectNode() : anchor;
        repository.insertComment(
                id, workspaceId, pageId, parentId, safeAnchor,
                body, plainText.trim(), actorId, now);
        activities.recordPageComment(workspaceId, actorId, pageId);
        if (parent != null && !parent.createdBy().equals(actorId)) {
            JsonNode payload = objectMapper.createObjectNode()
                    .put("commentId", id.toString())
                    .put("preview", abbreviate(plainText.trim(), 160))
                    .put("viaShare", true);
            notifications.notify(
                    parent.createdBy(), workspaceId, "COMMENT_REPLY", actorId,
                    "PAGE", pageId, safeAnchor, payload,
                    "comment-reply:" + parent.id() + ":" + parent.createdBy());
        }
        auditService.success(
                workspaceId, actorId, "comment.create-via-share", "COMMENT", id);
        return requireComment(id);
    }

    /** Deletes the visitor's own comment after the caller validates the share policy. */
    @Transactional
    public void deleteViaShare(UUID actorId, UUID pageId, UUID commentId) {
        CommentView comment = requireComment(commentId);
        if (!comment.pageId().equals(pageId) || !comment.createdBy().equals(actorId)) {
            throw new io.knowledge.platform.authorization.AuthorizationDeniedException();
        }
        repository.deleteComment(commentId, OffsetDateTime.now(clock));
        auditService.success(
                comment.workspaceId(), actorId, "comment.delete-via-share", "COMMENT", commentId);
    }

    @Transactional
    public CommentView update(
            UUID actorId, UUID commentId, JsonNode body, String plainText) {
        CommentView comment = requireComment(commentId);
        authorization.require(actorId, ResourceType.PAGE, comment.pageId(), Capability.COMMENT);
        if (!comment.createdBy().equals(actorId)) {
            throw new io.knowledge.platform.authorization.AuthorizationDeniedException();
        }
        validateBody(body, plainText);
        repository.updateComment(commentId, body, plainText.trim(), actorId, OffsetDateTime.now(clock));
        auditService.success(
                comment.workspaceId(), actorId, "comment.update", "COMMENT", commentId);
        return requireComment(commentId);
    }

    @Transactional
    public CommentView resolve(UUID actorId, UUID commentId, boolean resolved) {
        CommentView comment = requireComment(commentId);
        AuthorizationDecision decision =
                authorization.require(actorId, ResourceType.PAGE, comment.pageId(), Capability.COMMENT);
        if (!comment.createdBy().equals(actorId) && !decision.allows(Capability.MANAGE)) {
            throw new io.knowledge.platform.authorization.AuthorizationDeniedException();
        }
        repository.resolveComment(commentId, actorId, resolved, OffsetDateTime.now(clock));
        auditService.success(
                comment.workspaceId(), actorId,
                resolved ? "comment.resolve" : "comment.reopen", "COMMENT", commentId);
        return requireComment(commentId);
    }

    @Transactional
    public void delete(UUID actorId, UUID commentId) {
        CommentView comment = requireComment(commentId);
        AuthorizationDecision decision =
                authorization.require(actorId, ResourceType.PAGE, comment.pageId(), Capability.COMMENT);
        if (!comment.createdBy().equals(actorId) && !decision.allows(Capability.MANAGE)) {
            throw new io.knowledge.platform.authorization.AuthorizationDeniedException();
        }
        repository.deleteComment(commentId, OffsetDateTime.now(clock));
        auditService.success(
                comment.workspaceId(), actorId, "comment.delete", "COMMENT", commentId);
    }

    private CommentView requireComment(UUID id) {
        CommentView value = repository.findComment(id);
        if (value == null) throw new ResourceNotFoundException();
        return value;
    }

    private CommentPageView page(UUID pageId, int limit, int offset) {
        int count = Math.max(1, Math.min(limit, 100));
        int start = Math.max(0, offset);
        List<CommentView> rows = repository.comments(pageId, count + 1, start);
        boolean hasMore = rows.size() > count;
        List<CommentView> items = List.copyOf(rows.subList(0, Math.min(rows.size(), count)));
        return new CommentPageView(items, start + items.size(), hasMore);
    }

    private static void validateBody(JsonNode body, String plainText) {
        if (body == null || !body.isObject() || plainText == null || plainText.trim().isEmpty()) {
            throw new IllegalArgumentException("Comment body is required");
        }
        if (plainText.trim().length() > 20_000) {
            throw new IllegalArgumentException("Comment is too long");
        }
    }

    private static String abbreviate(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }
}
