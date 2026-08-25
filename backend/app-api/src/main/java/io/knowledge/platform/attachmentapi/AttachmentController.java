package io.knowledge.platform.attachmentapi;

import io.knowledge.platform.attachment.AttachmentContent;
import io.knowledge.platform.attachment.AttachmentService;
import io.knowledge.platform.attachment.AttachmentView;
import io.knowledge.platform.security.PlatformPrincipal;
import io.knowledge.platform.share.ShareService;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/attachments")
final class AttachmentController {

    private final AttachmentService service;
    private final ShareService shares;

    AttachmentController(AttachmentService service, ShareService shares) {
        this.service = service;
        this.shares = shares;
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<AttachmentView> upload(
            @RequestParam(required = false) UUID workspaceId,
            @RequestParam(required = false) UUID pageId,
            @RequestParam MultipartFile file,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        try (var input = file.getInputStream()) {
            AttachmentView attachment = service.upload(
                    principal.userId(),
                    workspaceId,
                    pageId,
                    file.getOriginalFilename(),
                    file.getContentType(),
                    file.getSize(),
                    input);
            return ResponseEntity.status(201).body(attachment);
        } catch (IOException exception) {
            throw new IllegalStateException("Uploaded file could not be read", exception);
        }
    }

    @GetMapping("/{attachmentId}")
    AttachmentView get(
            @PathVariable UUID attachmentId,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.get(principal.userId(), attachmentId);
    }

    @GetMapping("/{attachmentId}/content")
    ResponseEntity<Resource> content(
            @PathVariable UUID attachmentId,
            @RequestParam(defaultValue = "false") boolean download,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        AttachmentContent content = principal == null
                ? service.publicContent(attachmentId)
                : service.content(principal.userId(), attachmentId);
        return response(content, download);
    }

    @GetMapping("/{attachmentId}/shared-content")
    ResponseEntity<Resource> sharedContent(
            @PathVariable UUID attachmentId,
            @RequestParam String shareToken,
            @RequestParam(required = false) String shareAccessToken,
            @RequestParam(required = false) UUID sharePageId,
            @RequestParam(defaultValue = "false") boolean download,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        var access = shares.attachmentAccess(
                shareToken,
                shareAccessToken,
                sharePageId,
                principal == null ? null : principal.userId());
        AttachmentContent content = service.sharedContent(
                access.pageId(), access.publicationId(), attachmentId);
        return response(content, download, CacheControl.noStore());
    }

    static ResponseEntity<Resource> response(AttachmentContent content, boolean download) {
        return response(
                content,
                download,
                CacheControl.maxAge(Duration.ofHours(1)).cachePrivate());
    }

    static ResponseEntity<Resource> response(
            AttachmentContent content,
            boolean download,
            CacheControl cacheControl) {
        AttachmentView attachment = content.attachment();
        MediaType mediaType;
        try {
            mediaType = MediaType.parseMediaType(attachment.mediaType());
        } catch (IllegalArgumentException exception) {
            mediaType = MediaType.APPLICATION_OCTET_STREAM;
        }
        boolean safeInline = (attachment.mediaType().startsWith("image/")
                && !"image/svg+xml".equals(attachment.mediaType()))
                || "application/pdf".equals(attachment.mediaType())
                || attachment.mediaType().startsWith("audio/")
                || attachment.mediaType().startsWith("video/");
        ContentDisposition disposition = (download || !safeInline
                        ? ContentDisposition.attachment()
                        : ContentDisposition.inline())
                .filename(attachment.originalName(), StandardCharsets.UTF_8)
                .build();
        return ResponseEntity.ok()
                .contentType(mediaType)
                .contentLength(attachment.sizeBytes())
                .cacheControl(cacheControl)
                .eTag('"' + attachment.checksumSha256() + '"')
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(content.resource());
    }

    @PostMapping("/list")
    List<AttachmentView> list(
            @RequestBody PageRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.listPage(principal.userId(), request.pageId());
    }

    @PostMapping("/delete")
    ResponseEntity<Void> delete(
            @RequestBody AttachmentRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.delete(principal.userId(), request.attachmentId());
        return ResponseEntity.noContent().build();
    }

    record PageRequest(UUID pageId) {}

    record AttachmentRequest(UUID attachmentId) {}
}
