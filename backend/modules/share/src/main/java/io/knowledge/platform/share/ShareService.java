package io.knowledge.platform.share;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.analytics.AnalyticsEventCommand;
import io.knowledge.platform.analytics.AnalyticsRecorder;
import io.knowledge.platform.authorization.AuthorizationDecision;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.authorization.UpsertAclCommand;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.engagement.CommentService;
import io.knowledge.platform.engagement.CommentPageView;
import io.knowledge.platform.engagement.CommentView;
import io.knowledge.platform.engagement.NotificationService;
import io.knowledge.platform.publication.PagePublicationView;
import io.knowledge.platform.publication.PublicationService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ShareService {

    private static final Duration ACCESS_SESSION_TTL = Duration.ofMinutes(30);
    private static final int MAX_PASSWORD_FAILURES_PER_HOUR = 10;
    private final ShareRepository repository;
    private final AuthorizationService authorization;
    private final PublicationService publicationService;
    private final AuditService auditService;
    private final AnalyticsRecorder analytics;
    private final CommentService comments;
    private final NotificationService notifications;
    private final PasswordEncoder passwordEncoder;
    private final ObjectMapper mapper;
    private final SecureRandom secureRandom = new SecureRandom();
    private final Clock clock;

    public ShareService(
            ShareRepository repository,
            AuthorizationService authorization,
            PublicationService publicationService,
            AuditService auditService,
            AnalyticsRecorder analytics,
            CommentService comments,
            NotificationService notifications,
            PasswordEncoder passwordEncoder,
            ObjectMapper mapper,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.publicationService = publicationService;
        this.auditService = auditService;
        this.analytics = analytics;
        this.comments = comments;
        this.notifications = notifications;
        this.passwordEncoder = passwordEncoder;
        this.mapper = mapper;
        this.clock = clock;
    }

    @Transactional
    public CreatedShare create(UUID actorId, CreateShareCommand command) {
        if (command == null || command.resourceId() == null) {
            throw new IllegalArgumentException("Share resource id is required");
        }
        ResourceType resourceType = resourceType(command.resourceType());
        String shareType = shareType(command.shareType());
        if (resourceType == ResourceType.QUICK_NOTE && !"PUBLIC".equals(shareType)) {
            throw new IllegalArgumentException("Quick notes support public snapshot links only");
        }
        AuthorizationDecision decision = authorization.require(
                actorId,
                resourceType,
                command.resourceId(),
                "INVITE_LINK".equals(shareType)
                        ? Capability.MANAGE_PERMISSIONS
                        : Capability.SHARE);
        if (resourceType == ResourceType.PAGE && "PUBLIC".equals(shareType)) {
            publicationService.currentSnapshot(command.resourceId());
        } else if (resourceType == ResourceType.KNOWLEDGE_BASE) {
            repository.knowledgeBaseShare(command.resourceId(), null);
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        OffsetDateTime expiresAt = validateExpiration(command.expiresAt(), now);
        String rawToken = token();
        String passwordHash = passwordHash(command.password());
        String role = role(command.role(), shareType);
        if (resourceType == ResourceType.QUICK_NOTE && !"READER".equals(role)) {
            throw new IllegalArgumentException("Quick note shares are read-only");
        }
        ShareRepository.ShareRecord share = new ShareRepository.ShareRecord(
                Ids.next(),
                decision.workspaceId(),
                resourceType.name(),
                command.resourceId(),
                shareType,
                hash(rawToken),
                passwordHash,
                role,
                Boolean.TRUE.equals(command.requireApproval()),
                expiresAt,
                command.allowCopy() == null || command.allowCopy(),
                Boolean.TRUE.equals(command.allowDownload()),
                Boolean.TRUE.equals(command.allowExport()),
                resourceType != ResourceType.QUICK_NOTE
                        && (Set.of("COMMENTER", "EDITOR").contains(role)
                                || Boolean.TRUE.equals(command.allowComment())),
                resourceType != ResourceType.QUICK_NOTE
                        && "PUBLIC".equals(shareType)
                        && Boolean.TRUE.equals(command.allowSearchIndex()),
                1,
                actorId,
                null,
                now,
                now);
        repository.insert(share);
        if (resourceType == ResourceType.QUICK_NOTE) {
            repository.insertQuickNoteSnapshot(share.id(), share.resourceId(), actorId, now);
        }
        analytics.record(new AnalyticsEventCommand(
                decision.workspaceId(), actorId, null, resourceType.name(), command.resourceId(),
                resourceType == ResourceType.KNOWLEDGE_BASE ? command.resourceId() : null,
                "SHARE", null, tools.jackson.databind.node.JsonNodeFactory.instance.objectNode()));
        auditService.success(
                decision.workspaceId(), actorId, "share.create", "SHARE", share.id());
        return new CreatedShare(ShareRepository.view(share), rawToken);
    }

    @Transactional(readOnly = true)
    public List<ShareView> list(UUID actorId, String resourceTypeValue, UUID resourceId) {
        ResourceType resourceType = resourceType(resourceTypeValue);
        authorization.require(actorId, resourceType, resourceId, Capability.SHARE);
        return repository.listForResource(resourceType.name(), resourceId);
    }

    @Transactional
    public ShareView update(UUID actorId, UpdateShareCommand command) {
        if (command == null || command.shareId() == null) {
            throw new IllegalArgumentException("Share id is required");
        }
        ShareRepository.ShareRecord current = requireManaged(actorId, command.shareId());
        OffsetDateTime now = OffsetDateTime.now(clock);
        String updatedPasswordHash = current.passwordHash();
        if (command.clearPassword()) {
            updatedPasswordHash = null;
        } else if (command.password() != null) {
            updatedPasswordHash = passwordHash(command.password());
        }
        String updatedRole = command.role() == null
                ? current.role()
                : role(command.role(), current.shareType());
        if ("QUICK_NOTE".equals(current.resourceType()) && !"READER".equals(updatedRole)) {
            throw new IllegalArgumentException("Quick note shares are read-only");
        }
        ShareRepository.ShareRecord updated = new ShareRepository.ShareRecord(
                current.id(),
                current.workspaceId(),
                current.resourceType(),
                current.resourceId(),
                current.shareType(),
                current.tokenHash(),
                updatedPasswordHash,
                updatedRole,
                command.requireApproval() == null
                        ? current.requireApproval()
                        : command.requireApproval(),
                command.expiresAt() == null
                        ? current.expiresAt()
                        : validateExpiration(command.expiresAt(), now),
                command.allowCopy() == null ? current.allowCopy() : command.allowCopy(),
                command.allowDownload() == null
                        ? current.allowDownload()
                        : command.allowDownload(),
                command.allowExport() == null ? current.allowExport() : command.allowExport(),
                !"QUICK_NOTE".equals(current.resourceType())
                        && (Set.of("COMMENTER", "EDITOR").contains(updatedRole)
                        || (command.allowComment() == null
                                ? current.allowComment()
                                : command.allowComment())),
                command.allowSearchIndex() == null
                        ? current.allowSearchIndex()
                        : !"QUICK_NOTE".equals(current.resourceType())
                                && "PUBLIC".equals(current.shareType())
                                && command.allowSearchIndex(),
                current.policyVersion() + 1,
                current.createdBy(),
                current.revokedAt(),
                current.createdAt(),
                now);
        repository.update(updated);
        auditService.success(
                updated.workspaceId(), actorId, "share.update", "SHARE", updated.id());
        return ShareRepository.view(updated);
    }

    @Transactional
    public CreatedShare resetToken(UUID actorId, UUID shareId) {
        ShareRepository.ShareRecord share = requireManaged(actorId, shareId);
        String rawToken = token();
        OffsetDateTime now = OffsetDateTime.now(clock);
        repository.replaceToken(
                shareId, hash(rawToken), share.policyVersion() + 1, now);
        auditService.success(
                share.workspaceId(), actorId, "share.reset-token", "SHARE", shareId);
        ShareRepository.ShareRecord reloaded = repository.findForUpdate(shareId);
        return new CreatedShare(ShareRepository.view(reloaded), rawToken);
    }

    @Transactional
    public void revoke(UUID actorId, UUID shareId) {
        ShareRepository.ShareRecord share = requireManaged(actorId, shareId);
        repository.revoke(shareId, OffsetDateTime.now(clock));
        auditService.success(
                share.workspaceId(), actorId, "share.revoke", "SHARE", shareId);
    }

    @Transactional
    public ShareResolution resolve(
            String rawToken,
            String accessToken,
            UUID requestedPageId,
            String visitorHash,
            UUID actorId,
            String analyticsVisitorHash) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        ShareRepository.ShareRecord share = requireActive(rawToken, now);
        if (share.passwordHash() != null
                && (accessToken == null
                        || !repository.validAccessSession(share.id(), hash(accessToken), now))) {
            repository.visit(share.id(), visitorHash, null, "PASSWORD_REQUIRED", now);
            return new ShareResolution(
                    ShareRepository.view(share), true, false, null,
                    null, null, null, null, null, false, null);
        }
        if ("INVITE_LINK".equals(share.shareType()) && actorId == null) {
            repository.visit(share.id(), visitorHash, null, "APPROVAL_REQUIRED", now);
            return new ShareResolution(
                    ShareRepository.view(share), false, true,
                    "AUTHENTICATION_REQUIRED", null, null, null, null, null, false, null);
        }
        if (share.requireApproval() && !share.createdBy().equals(actorId)) {
            String approvalStatus = actorId == null
                    ? "AUTHENTICATION_REQUIRED"
                    : repository.approvalStatus(share.id(), actorId, share.policyVersion());
            if (!"APPROVED".equals(approvalStatus)) {
                repository.visit(share.id(), visitorHash, actorId, "APPROVAL_REQUIRED", now);
                return new ShareResolution(
                        ShareRepository.view(share), false, true,
                        approvalStatus == null ? "NOT_REQUESTED" : approvalStatus,
                        null, null, null, null, null, false, null);
            }
        }
        if ("INVITE_LINK".equals(share.shareType())) {
            UUID knowledgeBaseId = "KNOWLEDGE_BASE".equals(share.resourceType())
                    ? share.resourceId()
                    : repository.pageKnowledgeBaseId(share.resourceId());
            if (knowledgeBaseId == null) throw new ResourceNotFoundException();
            boolean acceptanceRequired = !repository.inviteAccepted(share, actorId);
            repository.visit(
                    share.id(), visitorHash, actorId,
                    acceptanceRequired ? "INVITE_PENDING" : "INVITE_ACCEPTED", now);
            return new ShareResolution(
                    ShareRepository.view(share), false, false, "APPROVED",
                    null, null, null, null, null, acceptanceRequired, knowledgeBaseId);
        }
        KnowledgeBaseShareView knowledgeBase = null;
        QuickNoteShareView quickNote = null;
        PagePublicationView publication;
        if ("KNOWLEDGE_BASE".equals(share.resourceType())) {
            knowledgeBase = repository.knowledgeBaseShare(share.resourceId(), requestedPageId);
            publication = knowledgeBase.selectedPageId() == null
                    ? null
                    : publicationService.currentSnapshot(knowledgeBase.selectedPageId());
        } else if ("QUICK_NOTE".equals(share.resourceType())) {
            quickNote = repository.quickNoteShare(share.id());
            publication = null;
        } else {
            publication = publicationService.currentSnapshot(share.resourceId());
        }
        ShareRepository.ReaderConfig readerConfig = quickNote == null
                ? repository.readerConfig(share.resourceType(), share.resourceId())
                : new ShareRepository.ReaderConfig(
                        mapper.createObjectNode(), mapper.createObjectNode());
        repository.visit(share.id(), visitorHash, actorId, "GRANTED", now);
        recordGrantedView(
                share, actorId, analyticsVisitorHash, publication, knowledgeBase, quickNote);
        return new ShareResolution(
                ShareRepository.view(share), false, false, "APPROVED", publication,
                readerConfig.appearanceConfig(), readerConfig.watermarkConfig(), knowledgeBase,
                quickNote, false, null);
    }

    @Transactional(readOnly = true)
    public ShareAttachmentAccess attachmentAccess(
            String rawToken,
            String accessToken,
            UUID requestedPageId,
            UUID actorId) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        ShareRepository.ShareRecord share = requireActive(rawToken, now);
        if ("QUICK_NOTE".equals(share.resourceType())) {
            throw new ResourceNotFoundException();
        }
        requireGrantedAccess(share, accessToken, actorId, now);
        UUID pageId = sharePage(share, requestedPageId);
        PagePublicationView publication = publicationService.currentSnapshot(pageId);
        return new ShareAttachmentAccess(pageId, publication.id());
    }

    private void recordGrantedView(
            ShareRepository.ShareRecord share,
            UUID actorId,
            String analyticsVisitorHash,
            PagePublicationView publication,
            KnowledgeBaseShareView knowledgeBase,
            QuickNoteShareView quickNote) {
        String resourceType;
        UUID resourceId;
        UUID knowledgeBaseId;
        if (quickNote != null) {
            resourceType = "QUICK_NOTE";
            resourceId = share.resourceId();
            knowledgeBaseId = null;
        } else if (publication != null) {
            resourceType = "PAGE";
            resourceId = publication.pageId();
            knowledgeBaseId = publication.knowledgeBaseId();
        } else if (knowledgeBase != null) {
            resourceType = "KNOWLEDGE_BASE";
            resourceId = knowledgeBase.id();
            knowledgeBaseId = knowledgeBase.id();
        } else {
            return;
        }
        ObjectNode details = mapper.createObjectNode()
                .put("source", "SHARE")
                .put("shareId", share.id().toString());
        analytics.record(new AnalyticsEventCommand(
                share.workspaceId(), actorId,
                actorId == null ? analyticsVisitorHash : null,
                resourceType, resourceId, knowledgeBaseId,
                "VIEW", null, details));
    }

    @Transactional
    public ShareAccessRequestView requestAccess(
            UUID actorId,
            String rawToken,
            String accessToken,
            String visitorHash,
            String message) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        ShareRepository.ShareRecord share = requireActive(rawToken, now);
        if (!share.requireApproval()) {
            throw new DomainConflictException(
                    "SHARE_APPROVAL_NOT_REQUIRED", "This share does not require approval");
        }
        if (share.passwordHash() != null
                && (accessToken == null
                        || !repository.validAccessSession(share.id(), hash(accessToken), now))) {
            throw new SharePasswordInvalidException();
        }
        String normalizedMessage = message == null || message.isBlank()
                ? null
                : message.trim();
        if (normalizedMessage != null && normalizedMessage.length() > 500) {
            throw new IllegalArgumentException("Access request message is too long");
        }
        ShareAccessRequestView request = repository.requestAccess(
                share.id(), actorId, share.policyVersion(), normalizedMessage, now);
        var anchor = JsonNodeFactory.instance.objectNode().put("requestId", request.id().toString());
        var payload = JsonNodeFactory.instance.objectNode()
                .put("status", request.status())
                .put("requesterEmail", request.requesterEmail());
        notifications.notify(
                share.createdBy(), share.workspaceId(), "SHARE_APPROVAL_REQUEST", actorId,
                share.resourceType(), share.resourceId(), anchor, payload,
                "share-approval-request:" + request.id());
        auditService.success(
                share.workspaceId(), actorId, "share.request-access", "SHARE", share.id());
        repository.visit(share.id(), visitorHash, actorId, "APPROVAL_REQUIRED", now);
        return request;
    }

    @Transactional
    public ShareAcceptance acceptInvite(
            UUID actorId,
            String rawToken,
            String accessToken) {
        if (actorId == null) {
            throw new io.knowledge.platform.authorization.AuthorizationDeniedException();
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        ShareRepository.ShareRecord share = requireActive(rawToken, now);
        if (!"INVITE_LINK".equals(share.shareType())) {
            throw new DomainConflictException(
                    "SHARE_NOT_INVITE_LINK", "This share is not an invitation link");
        }
        requireLinkAccess(share, accessToken, actorId, now);
        ResourceType resourceType = resourceType(share.resourceType());
        UUID knowledgeBaseId = resourceType == ResourceType.KNOWLEDGE_BASE
                ? share.resourceId()
                : repository.pageKnowledgeBaseId(share.resourceId());
        if (knowledgeBaseId == null) throw new ResourceNotFoundException();
        boolean alreadyAccepted = repository.inviteAccepted(share, actorId);
        if (!alreadyAccepted) {
            authorization.require(
                    share.createdBy(), resourceType, share.resourceId(),
                    Capability.MANAGE_PERMISSIONS);
            repository.ensureWorkspaceMembership(
                    share.workspaceId(), actorId,
                    "EDITOR".equals(share.role()) ? "MEMBER" : "EXTERNAL", now);
            if (resourceType == ResourceType.KNOWLEDGE_BASE) {
                repository.acceptKnowledgeBaseInvite(
                        share.resourceId(), actorId,
                        "EDITOR".equals(share.role()) ? "EDITOR" : "READER", now);
                authorization.invalidateWorkspace(share.workspaceId());
            } else {
                String aclRole = "EDITOR".equals(share.role()) ? "EDITOR" : null;
                Set<Capability> capabilities = switch (share.role()) {
                    case "COMMENTER" -> Set.of(Capability.READ, Capability.COMMENT);
                    case "READER" -> Set.of(Capability.READ);
                    default -> Set.of();
                };
                authorization.grant(
                        share.createdBy(),
                        new UpsertAclCommand(
                                ResourceType.PAGE, share.resourceId(), "USER", actorId,
                                aclRole, "ALLOW", capabilities));
            }
            ObjectNode payload = mapper.createObjectNode()
                    .put("role", share.role())
                    .put("resourceType", share.resourceType())
                    .put("acceptedBy", repository.userEmail(actorId));
            notifications.notify(
                    share.createdBy(), share.workspaceId(), "SHARE_INVITE_ACCEPTED", actorId,
                    share.resourceType(), share.resourceId(), mapper.createObjectNode(), payload,
                    "share-invite-accepted:" + share.id() + ":" + actorId);
            auditService.success(
                    share.workspaceId(), actorId, "share.accept-invite", "SHARE", share.id());
        }
        return new ShareAcceptance(
                share.resourceType(), share.resourceId(), knowledgeBaseId,
                share.role(), alreadyAccepted);
    }

    @Transactional
    public List<ShareAccessRequestView> accessRequests(UUID actorId, UUID shareId) {
        ShareRepository.ShareRecord share = requireManaged(actorId, shareId);
        return repository.accessRequests(share.id());
    }

    @Transactional
    public ShareAccessRequestView reviewAccessRequest(
            UUID actorId,
            UUID requestId,
            String decision) {
        ShareRepository.AccessRequestRecord request = repository.accessRequestForUpdate(requestId);
        if (request == null) {
            throw new ResourceNotFoundException();
        }
        ShareRepository.ShareRecord share = requireManaged(actorId, request.shareId());
        if (request.policyVersion() != share.policyVersion()) {
            throw new DomainConflictException(
                    "SHARE_REQUEST_STALE", "The share policy changed; ask the visitor to request again");
        }
        String normalized = decision == null ? "" : decision.toUpperCase(Locale.ROOT);
        String status = switch (normalized) {
            case "APPROVE", "APPROVED" -> "APPROVED";
            case "REJECT", "REJECTED" -> "REJECTED";
            default -> throw new IllegalArgumentException("Review decision must approve or reject");
        };
        OffsetDateTime now = OffsetDateTime.now(clock);
        ShareAccessRequestView reviewed = repository.reviewAccessRequest(
                request.id(), actorId, status, now);
        var anchor = JsonNodeFactory.instance.objectNode().put("requestId", request.id().toString());
        var payload = JsonNodeFactory.instance.objectNode().put("status", status);
        notifications.notify(
                request.requesterId(), share.workspaceId(), "SHARE_APPROVAL_REVIEWED", actorId,
                share.resourceType(), share.resourceId(), anchor, payload,
                "share-approval-reviewed:" + request.id());
        auditService.success(
                share.workspaceId(), actorId, "share.review-access", "SHARE", share.id());
        return reviewed;
    }

    @Transactional
    public ShareAccessToken verifyPassword(
            String rawToken,
            String password,
            String visitorHash) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        ShareRepository.ShareRecord share = requireActive(rawToken, now);
        if (share.passwordHash() == null) {
            throw new IllegalArgumentException("This share does not require a password");
        }
        if (repository.recentPasswordFailures(
                        share.id(), visitorHash, now.minusHours(1))
                >= MAX_PASSWORD_FAILURES_PER_HOUR) {
            throw new ShareRateLimitedException();
        }
        if (password == null || !passwordEncoder.matches(password, share.passwordHash())) {
            repository.visit(share.id(), visitorHash, null, "PASSWORD_FAILED", now);
            throw new SharePasswordInvalidException();
        }
        String accessToken = token();
        OffsetDateTime expiresAt = now.plus(ACCESS_SESSION_TTL);
        repository.insertAccessSession(share.id(), hash(accessToken), expiresAt, now);
        return new ShareAccessToken(accessToken, expiresAt);
    }

    @Transactional
    public ShareArtifact download(
            String rawToken,
            String accessToken,
            UUID requestedPageId,
            String visitorHash,
            UUID actorId) {
        return artifact(rawToken, accessToken, requestedPageId, visitorHash, actorId, false);
    }

    @Transactional
    public ShareArtifact export(
            String rawToken,
            String accessToken,
            UUID requestedPageId,
            String visitorHash,
            UUID actorId) {
        return artifact(rawToken, accessToken, requestedPageId, visitorHash, actorId, true);
    }

    @Transactional(readOnly = true)
    public List<CommentView> comments(
            String rawToken, String accessToken, UUID requestedPageId, UUID actorId) {
        ShareRepository.ShareRecord share = requireCommentable(
                rawToken, accessToken, actorId, OffsetDateTime.now(clock));
        UUID pageId = sharePage(share, requestedPageId);
        return comments.listViaShare(pageId).stream()
                .map(comment -> externalComment(comment, actorId))
                .toList();
    }

    @Transactional(readOnly = true)
    public CommentPageView commentPage(
            String rawToken, String accessToken, UUID requestedPageId, UUID actorId,
            int limit, int offset) {
        ShareRepository.ShareRecord share = requireCommentable(
                rawToken, accessToken, actorId, OffsetDateTime.now(clock));
        UUID pageId = sharePage(share, requestedPageId);
        CommentPageView page = comments.pageViaShare(pageId, limit, offset);
        return new CommentPageView(
                page.items().stream()
                        .map(comment -> externalComment(comment, actorId))
                        .toList(),
                page.nextOffset(),
                page.hasMore());
    }

    @Transactional
    public CommentView createComment(
            UUID actorId,
            String rawToken,
            String accessToken,
            UUID requestedPageId,
            UUID parentId,
            JsonNode anchor,
            JsonNode body,
            String plainText) {
        ShareRepository.ShareRecord share = requireCommentable(
                rawToken, accessToken, actorId, OffsetDateTime.now(clock));
        UUID pageId = sharePage(share, requestedPageId);
        CommentView created = comments.createViaShare(
                actorId, share.workspaceId(), pageId, parentId,
                anchor, body, plainText);
        if (!share.createdBy().equals(actorId)) {
            var payload = JsonNodeFactory.instance.objectNode()
                    .put("commentId", created.id().toString())
                    .put("preview", abbreviate(created.plainText(), 160))
                    .put("viaShare", true);
            notifications.notify(
                    share.createdBy(), share.workspaceId(), "SHARE_COMMENT", actorId,
                    "PAGE", pageId, created.anchor(), payload,
                    "share-comment:" + created.id());
        }
        return externalComment(created, actorId);
    }

    @Transactional
    public void deleteComment(
            UUID actorId,
            String rawToken,
            String accessToken,
            UUID requestedPageId,
            UUID commentId) {
        ShareRepository.ShareRecord share = requireCommentable(
                rawToken, accessToken, actorId, OffsetDateTime.now(clock));
        comments.deleteViaShare(actorId, sharePage(share, requestedPageId), commentId);
    }

    private ShareRepository.ShareRecord requireManaged(UUID actorId, UUID shareId) {
        ShareRepository.ShareRecord share = repository.findForUpdate(shareId);
        if (share == null) {
            throw new ResourceNotFoundException();
        }
        authorization.require(
                actorId, resourceType(share.resourceType()), share.resourceId(),
                "INVITE_LINK".equals(share.shareType())
                        ? Capability.MANAGE_PERMISSIONS
                        : Capability.SHARE);
        if (share.revokedAt() != null) {
            throw new ShareInvalidException();
        }
        return share;
    }

    private ShareRepository.ShareRecord requireActive(String rawToken, OffsetDateTime now) {
        ShareRepository.ShareRecord share =
                repository.findActiveByTokenHash(hash(requireToken(rawToken)));
        if (share == null || share.revokedAt() != null) {
            throw new ShareInvalidException();
        }
        if (share.expiresAt() != null && !share.expiresAt().isAfter(now)) {
            throw new ShareInvalidException();
        }
        return share;
    }

    private ShareRepository.ShareRecord requireCommentable(
            String rawToken,
            String accessToken,
            UUID actorId,
            OffsetDateTime now) {
        ShareRepository.ShareRecord share = requireActive(rawToken, now);
        if (!share.allowComment()) {
            throw new DomainConflictException(
                    "SHARE_COMMENTS_DISABLED", "Comments are disabled for this share");
        }
        requireGrantedAccess(share, accessToken, actorId, now);
        return share;
    }

    private UUID sharePage(ShareRepository.ShareRecord share, UUID requestedPageId) {
        if ("PAGE".equals(share.resourceType())) {
            if (requestedPageId != null && !share.resourceId().equals(requestedPageId)) {
                throw new ResourceNotFoundException();
            }
            publicationService.currentSnapshot(share.resourceId());
            return share.resourceId();
        }
        if (requestedPageId == null
                || !repository.knowledgeBasePageReadable(share.resourceId(), requestedPageId)) {
            throw new ResourceNotFoundException();
        }
        return requestedPageId;
    }

    private ShareArtifact artifact(
            String rawToken,
            String accessToken,
            UUID requestedPageId,
            String visitorHash,
            UUID actorId,
            boolean export) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        ShareRepository.ShareRecord share = requireActive(rawToken, now);
        if (export ? !share.allowExport() : !share.allowDownload()) {
            throw new DomainConflictException(
                    export ? "SHARE_EXPORT_DISABLED" : "SHARE_DOWNLOAD_DISABLED",
                    export
                            ? "Export is disabled for this share"
                            : "Download is disabled for this share");
        }
        requireGrantedAccess(share, accessToken, actorId, now);
        QuickNoteShareView quickNote = "QUICK_NOTE".equals(share.resourceType())
                ? repository.quickNoteShare(share.id())
                : null;
        KnowledgeBaseShareView knowledgeBase = "KNOWLEDGE_BASE".equals(share.resourceType())
                ? repository.knowledgeBaseShare(share.resourceId(), requestedPageId)
                : null;
        PagePublicationView publication = quickNote == null && knowledgeBase == null
                ? publicationService.currentSnapshot(share.resourceId())
                : null;
        List<PagePublicationView> publications = quickNote != null
                ? List.of()
                : knowledgeBase == null
                ? List.of(publication)
                : knowledgeBase.pages().stream()
                        .map(page -> publicationService.currentSnapshot(page.pageId()))
                        .toList();
        ShareRepository.ReaderConfig readerConfig = quickNote == null
                ? repository.readerConfig(share.resourceType(), share.resourceId())
                : new ShareRepository.ReaderConfig(
                        mapper.createObjectNode(), mapper.createObjectNode());
        Watermark watermark = watermark(readerConfig.watermarkConfig(), actorId);
        ShareArtifact result = quickNote != null
                ? export ? quickNoteJsonArtifact(quickNote) : quickNoteTextArtifact(quickNote)
                : knowledgeBase == null
                ? export
                        ? jsonArtifact(publication, watermark)
                        : textArtifact(publication, watermark)
                : export
                        ? knowledgeBaseJsonArtifact(knowledgeBase, publications, watermark)
                        : knowledgeBaseTextArtifact(knowledgeBase, publications, watermark);
        repository.visit(share.id(), visitorHash, actorId, "GRANTED", now);
        ObjectNode details = mapper.createObjectNode()
                .put("shareId", share.id().toString())
                .put("format", export ? "JSON" : "TEXT")
                .put("watermarkApplied", watermark.enabled());
        analytics.record(new AnalyticsEventCommand(
                share.workspaceId(), actorId, actorId == null ? visitorHash : null,
                share.resourceType(), share.resourceId(),
                quickNote != null
                        ? null
                        : knowledgeBase == null
                                ? publication.knowledgeBaseId()
                                : knowledgeBase.id(),
                "EXPORT", null, details));
        auditService.record(
                share.workspaceId(), actorId,
                export ? "share.export" : "share.download",
                "SHARE", share.id(), "SUCCESS", mapper.writeValueAsString(details));
        return result;
    }

    private ShareArtifact quickNoteTextArtifact(QuickNoteShareView quickNote) {
        return new ShareArtifact(
                filename("小记-版本-" + quickNote.sourceRevision(), "txt"),
                "text/plain; charset=utf-8",
                quickNote.plainText().getBytes(StandardCharsets.UTF_8));
    }

    private ShareArtifact quickNoteJsonArtifact(QuickNoteShareView quickNote) {
        ObjectNode document = mapper.createObjectNode();
        document.put("id", quickNote.id().toString());
        document.put("sourceRevision", quickNote.sourceRevision());
        document.put("capturedAt", quickNote.capturedAt().toString());
        document.put("plainText", quickNote.plainText());
        document.set("content", quickNote.content());
        return new ShareArtifact(
                filename("小记-版本-" + quickNote.sourceRevision(), "json"),
                "application/json; charset=utf-8",
                mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(document));
    }

    private void requireGrantedAccess(
            ShareRepository.ShareRecord share,
            String accessToken,
            UUID actorId,
            OffsetDateTime now) {
        requireLinkAccess(share, accessToken, actorId, now);
        if ("INVITE_LINK".equals(share.shareType())
                && !repository.inviteAccepted(share, actorId)) {
            throw new io.knowledge.platform.authorization.AuthorizationDeniedException();
        }
    }

    private void requireLinkAccess(
            ShareRepository.ShareRecord share,
            String accessToken,
            UUID actorId,
            OffsetDateTime now) {
        if ("INVITE_LINK".equals(share.shareType()) && actorId == null) {
            throw new io.knowledge.platform.authorization.AuthorizationDeniedException();
        }
        if (share.passwordHash() != null
                && (accessToken == null
                        || !repository.validAccessSession(share.id(), hash(accessToken), now))) {
            throw new SharePasswordInvalidException();
        }
        if (share.requireApproval() && !share.createdBy().equals(actorId)) {
            if (actorId == null
                    || !"APPROVED".equals(repository.approvalStatus(
                            share.id(), actorId, share.policyVersion()))) {
                throw new io.knowledge.platform.authorization.AuthorizationDeniedException();
            }
        }
    }

    private ShareArtifact textArtifact(PagePublicationView publication, Watermark watermark) {
        StringBuilder content = new StringBuilder()
                .append(publication.title())
                .append("\n\n")
                .append(publication.plainText());
        if (watermark.enabled()) {
            content.append("\n\n---\n水印：").append(watermark.text());
        }
        return new ShareArtifact(
                filename(publication.title(), "txt"),
                "text/plain; charset=utf-8",
                content.toString().getBytes(StandardCharsets.UTF_8));
    }

    private ShareArtifact jsonArtifact(PagePublicationView publication, Watermark watermark) {
        ObjectNode document = mapper.createObjectNode();
        document.put("id", publication.id().toString());
        document.put("pageId", publication.pageId().toString());
        document.put("contentType", publication.contentType());
        document.put("title", publication.title());
        document.put("schemaVersion", publication.schemaVersion());
        document.put("publishedAt", publication.publishedAt().toString());
        document.set("metadata", publication.metadata());
        document.set("content", publication.content());
        if (watermark.enabled()) {
            ObjectNode mark = document.putObject("watermark");
            mark.put("text", watermark.text());
            mark.put("position", watermark.position());
            mark.put("opacity", watermark.opacity());
        }
        return new ShareArtifact(
                filename(publication.title(), "json"),
                "application/json; charset=utf-8",
                mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(document));
    }

    private ShareArtifact knowledgeBaseTextArtifact(
            KnowledgeBaseShareView knowledgeBase,
            List<PagePublicationView> publications,
            Watermark watermark) {
        StringBuilder content = new StringBuilder()
                .append(knowledgeBase.name())
                .append("\n")
                .append(knowledgeBase.description() == null ? "" : knowledgeBase.description());
        for (PagePublicationView publication : publications) {
            content.append("\n\n====================\n")
                    .append(publication.title())
                    .append("\n====================\n\n")
                    .append(publication.plainText());
        }
        if (watermark.enabled()) {
            content.append("\n\n---\n水印：").append(watermark.text());
        }
        return new ShareArtifact(
                filename(knowledgeBase.name(), "txt"),
                "text/plain; charset=utf-8",
                content.toString().getBytes(StandardCharsets.UTF_8));
    }

    private ShareArtifact knowledgeBaseJsonArtifact(
            KnowledgeBaseShareView knowledgeBase,
            List<PagePublicationView> publications,
            Watermark watermark) {
        ObjectNode document = mapper.createObjectNode();
        document.set("knowledgeBase", mapper.valueToTree(knowledgeBase));
        document.set("publications", mapper.valueToTree(publications));
        if (watermark.enabled()) {
            ObjectNode mark = document.putObject("watermark");
            mark.put("text", watermark.text());
            mark.put("position", watermark.position());
            mark.put("opacity", watermark.opacity());
        }
        return new ShareArtifact(
                filename(knowledgeBase.name(), "json"),
                "application/json; charset=utf-8",
                mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(document));
    }

    private Watermark watermark(JsonNode config, UUID actorId) {
        if (config == null || !config.path("enabled").asBoolean(false)) {
            return new Watermark(false, "", "FOOTER", .12);
        }
        String viewer = actorId == null ? "公开访客" : repository.userEmail(actorId);
        if (viewer == null || viewer.isBlank()) viewer = "公开访客";
        JsonNode textNode = config.path("text");
        String text = (textNode.isString() ? textNode.stringValue() : "{{email}}").trim();
        if (text.isBlank()) text = "{{email}}";
        text = text.substring(0, Math.min(text.length(), 120)).replace("{{email}}", viewer);
        JsonNode positionNode = config.path("position");
        String position = (positionNode.isString()
                        ? positionNode.stringValue()
                        : "FOOTER")
                .toUpperCase(Locale.ROOT);
        if (!Set.of("CENTER", "TILED", "FOOTER").contains(position)) position = "FOOTER";
        double opacity = Math.max(.05, Math.min(.4, config.path("opacity").asDouble(.12)));
        return new Watermark(true, text, position, opacity);
    }

    private static String filename(String title, String extension) {
        String safe = title == null ? "shared-page" : title
                .replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "-")
                .trim();
        if (safe.isBlank()) safe = "shared-page";
        return safe.substring(0, Math.min(safe.length(), 120)) + "." + extension;
    }

    private static CommentView externalComment(CommentView value, UUID viewerId) {
        String label = value.createdBy().equals(viewerId)
                ? "你"
                : maskEmail(value.creatorEmail());
        return new CommentView(
                value.id(), value.workspaceId(), value.pageId(), value.parentId(),
                value.anchor(), value.body(), value.plainText(), value.status(),
                value.createdBy(), label, value.resolvedBy(), value.resolvedAt(),
                value.createdAt(), value.updatedAt());
    }

    private static String maskEmail(String value) {
        if (value == null || value.isBlank()) return "访客";
        int at = value.indexOf('@');
        if (at <= 0) return value.substring(0, 1) + "***";
        return value.substring(0, 1) + "***" + value.substring(at);
    }

    private static String abbreviate(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }

    private String token() {
        byte[] value = new byte[32];
        secureRandom.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private String passwordHash(String password) {
        if (password == null || password.isBlank()) {
            return null;
        }
        if (password.length() < 8 || password.length() > 200) {
            throw new IllegalArgumentException(
                    "Share password must be between 8 and 200 characters");
        }
        return passwordEncoder.encode(password);
    }

    private static String role(String value, String shareType) {
        String normalized = value == null ? "READER" : value.toUpperCase(Locale.ROOT);
        Set<String> supported = "INVITE_LINK".equals(shareType)
                ? Set.of("READER", "COMMENTER", "EDITOR")
                : Set.of("READER", "COMMENTER");
        if (!supported.contains(normalized)) {
            throw new IllegalArgumentException(
                    "Share role is not supported by this link type");
        }
        return normalized;
    }

    private static String shareType(String value) {
        String normalized = value == null ? "PUBLIC" : value.toUpperCase(Locale.ROOT);
        if (!Set.of("PUBLIC", "INVITE_LINK").contains(normalized)) {
            throw new IllegalArgumentException("Share type must be public or invite link");
        }
        return normalized;
    }

    private static ResourceType resourceType(String value) {
        String normalized = value == null ? "PAGE" : value.toUpperCase(Locale.ROOT);
        if (!Set.of("PAGE", "KNOWLEDGE_BASE", "QUICK_NOTE").contains(normalized)) {
            throw new IllegalArgumentException(
                    "Shares support pages, knowledge bases, and quick notes");
        }
        return ResourceType.valueOf(normalized);
    }

    private static OffsetDateTime validateExpiration(
            OffsetDateTime expiresAt,
            OffsetDateTime now) {
        if (expiresAt != null && !expiresAt.isAfter(now.plusMinutes(1))) {
            throw new IllegalArgumentException("Share expiration must be in the future");
        }
        return expiresAt;
    }

    private static String requireToken(String value) {
        if (value == null || value.length() < 32 || value.length() > 256) {
            throw new ShareInvalidException();
        }
        return value;
    }

    private static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }

    private record Watermark(boolean enabled, String text, String position, double opacity) {}
}
