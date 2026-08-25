package io.knowledge.platform.collaborationapi;

import io.knowledge.platform.page.CollaborationMaterializationView;
import io.knowledge.platform.page.ContentType;
import io.knowledge.platform.page.PageService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/internal/v1/collaboration")
final class InternalCollaborationController {

    private final PageService pageService;
    private final byte[] expectedToken;

    InternalCollaborationController(
            PageService pageService,
            @Value("${COLLAB_INTERNAL_TOKEN:}") String internalToken) {
        this.pageService = pageService;
        this.expectedToken = internalToken.getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping("/materialize")
    CollaborationMaterializationView materialize(
            @RequestHeader(value = "X-Internal-Token", required = false) String suppliedToken,
            @RequestBody MaterializationRequest request) {
        authenticate(suppliedToken);
        return pageService.materializeCollaboration(
                request.pageId(),
                request.sequence(),
                request.actorId(),
                request.contentType(),
                request.plainText());
    }

    private void authenticate(String suppliedToken) {
        if (expectedToken.length < 32) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE, "Internal collaboration token is not configured");
        }
        byte[] supplied = suppliedToken == null
                ? new byte[0]
                : suppliedToken.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expectedToken, supplied)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Internal token is invalid");
        }
    }

    record MaterializationRequest(
            UUID pageId,
            long sequence,
            UUID actorId,
            ContentType contentType,
            String plainText) {}
}
