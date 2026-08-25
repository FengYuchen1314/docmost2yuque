package io.knowledge.platform.shareapi;

import io.knowledge.platform.common.PrivacyHasher;
import io.knowledge.platform.engagement.CommentView;
import io.knowledge.platform.engagement.CommentPageView;
import io.knowledge.platform.security.PlatformPrincipal;
import io.knowledge.platform.share.CreateShareCommand;
import io.knowledge.platform.share.CreatedShare;
import io.knowledge.platform.share.ShareAccessToken;
import io.knowledge.platform.share.ShareAcceptance;
import io.knowledge.platform.share.ShareArtifact;
import io.knowledge.platform.share.ShareAccessRequestView;
import io.knowledge.platform.share.ShareResolution;
import io.knowledge.platform.share.ShareService;
import io.knowledge.platform.share.ShareView;
import io.knowledge.platform.share.UpdateShareCommand;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/shares")
final class ShareController {

    private final ShareService service;
    private final PrivacyHasher privacyHasher;

    ShareController(ShareService service, PrivacyHasher privacyHasher) {
        this.service = service;
        this.privacyHasher = privacyHasher;
    }

    @PostMapping("/list")
    List<ShareView> list(
            @RequestBody ShareRequests.Resource request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        String resourceType = request.resourceType() == null ? "PAGE" : request.resourceType();
        UUID resourceId = request.resourceId() == null ? request.pageId() : request.resourceId();
        return service.list(principal.userId(), resourceType, resourceId);
    }

    @PostMapping("/create")
    ResponseEntity<CreatedShare> create(
            @RequestBody ShareRequests.Create request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        CreatedShare share = service.create(
                principal.userId(),
                new CreateShareCommand(
                        request.resourceType() == null ? "PAGE" : request.resourceType(),
                        request.resourceId() == null ? request.pageId() : request.resourceId(),
                        request.shareType(),
                        request.password(),
                        request.role(),
                        request.requireApproval(),
                        request.expiresAt(),
                        request.allowCopy(),
                        request.allowDownload(),
                        request.allowExport(),
                        request.allowComment(),
                        request.allowSearchIndex()));
        return ResponseEntity.status(201).body(share);
    }

    @PostMapping("/update")
    ShareView update(
            @RequestBody ShareRequests.Update request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.update(
                principal.userId(),
                new UpdateShareCommand(
                        request.shareId(),
                        request.password(),
                        request.clearPassword(),
                        request.role(),
                        request.requireApproval(),
                        request.expiresAt(),
                        request.allowCopy(),
                        request.allowDownload(),
                        request.allowExport(),
                        request.allowComment(),
                        request.allowSearchIndex()));
    }

    @PostMapping("/reset-token")
    CreatedShare resetToken(
            @RequestBody ShareRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.resetToken(principal.userId(), request.shareId());
    }

    @PostMapping("/revoke")
    ResponseEntity<Void> revoke(
            @RequestBody ShareRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.revoke(principal.userId(), request.shareId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/resolve")
    ShareResolution resolve(
            @RequestBody ShareRequests.Resolve request,
            HttpServletRequest servletRequest,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.resolve(
                request.token(),
                request.accessToken(),
                request.pageId(),
                visitorHash(servletRequest),
                principal == null ? null : principal.userId(),
                analyticsVisitorHash(servletRequest));
    }

    @PostMapping("/verify-password")
    ShareAccessToken verifyPassword(
            @RequestBody ShareRequests.VerifyPassword request,
            HttpServletRequest servletRequest) {
        return service.verifyPassword(
                request.token(), request.password(), visitorHash(servletRequest));
    }

    @PostMapping("/download")
    ResponseEntity<byte[]> download(
            @RequestBody ShareRequests.Resolve request,
            HttpServletRequest servletRequest,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return artifact(service.download(
                request.token(), request.accessToken(), request.pageId(), visitorHash(servletRequest),
                principal == null ? null : principal.userId()));
    }

    @PostMapping("/export")
    ResponseEntity<byte[]> export(
            @RequestBody ShareRequests.Resolve request,
            HttpServletRequest servletRequest,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return artifact(service.export(
                request.token(), request.accessToken(), request.pageId(), visitorHash(servletRequest),
                principal == null ? null : principal.userId()));
    }

    @PostMapping("/request-join")
    ShareAccessRequestView requestJoin(
            @RequestBody ShareRequests.RequestJoin request,
            HttpServletRequest servletRequest,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.requestAccess(
                principal.userId(), request.token(), request.accessToken(),
                visitorHash(servletRequest), request.message());
    }

    @PostMapping("/accept-invite")
    ShareAcceptance acceptInvite(
            @RequestBody ShareRequests.AcceptInvite request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.acceptInvite(
                principal.userId(), request.token(), request.accessToken());
    }

    @PostMapping("/requests")
    List<ShareAccessRequestView> requests(
            @RequestBody ShareRequests.ListRequests request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.accessRequests(principal.userId(), request.shareId());
    }

    @PostMapping("/review-request")
    ShareAccessRequestView reviewRequest(
            @RequestBody ShareRequests.ReviewRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.reviewAccessRequest(
                principal.userId(), request.requestId(), request.decision());
    }

    @PostMapping("/comments/list")
    List<CommentView> comments(
            @RequestBody ShareRequests.CommentList request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.comments(
                request.token(), request.accessToken(),
                request.pageId(),
                principal == null ? null : principal.userId());
    }

    @PostMapping("/comments/page")
    CommentPageView commentPage(
            @RequestBody ShareRequests.CommentList request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.commentPage(
                request.token(), request.accessToken(), request.pageId(),
                principal == null ? null : principal.userId(),
                request.limit() == null ? 30 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }

    @PostMapping("/comments/create")
    ResponseEntity<CommentView> createComment(
            @RequestBody ShareRequests.CommentCreate request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        CommentView comment = service.createComment(
                principal.userId(), request.token(), request.accessToken(),
                request.pageId(),
                request.parentId(), request.anchor(), request.body(), request.plainText());
        return ResponseEntity.status(201).body(comment);
    }

    @PostMapping("/comments/delete")
    ResponseEntity<Void> deleteComment(
            @RequestBody ShareRequests.CommentDelete request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.deleteComment(
                principal.userId(), request.token(), request.accessToken(),
                request.pageId(), request.commentId());
        return ResponseEntity.noContent().build();
    }

    private String visitorHash(HttpServletRequest request) {
        return privacyHasher.hash("share.ip", request.getRemoteAddr());
    }

    private String analyticsVisitorHash(HttpServletRequest request) {
        return privacyHasher.hash("content.analytics.ip", request.getRemoteAddr());
    }

    private static ResponseEntity<byte[]> artifact(ShareArtifact artifact) {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(artifact.mediaType()))
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment()
                                .filename(artifact.filename(), StandardCharsets.UTF_8)
                                .build()
                                .toString())
                .body(artifact.bytes());
    }
}
