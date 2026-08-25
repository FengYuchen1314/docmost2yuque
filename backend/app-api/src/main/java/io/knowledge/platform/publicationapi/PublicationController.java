package io.knowledge.platform.publicationapi;

import io.knowledge.platform.publication.PagePublicationView;
import io.knowledge.platform.publication.PublicationHistoryPageView;
import io.knowledge.platform.publication.PublicationService;
import io.knowledge.platform.publication.PublicationState;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/pages")
final class PublicationController {

    private final PublicationService service;

    PublicationController(PublicationService service) {
        this.service = service;
    }

    @PostMapping("/publish")
    ResponseEntity<PagePublicationView> publish(
            @RequestBody PublicationRequests.Publish request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return ResponseEntity.status(201)
                .body(service.publish(
                        principal.userId(), request.pageId(), request.idempotencyKey()));
    }

    @PostMapping("/republish")
    ResponseEntity<PagePublicationView> republish(
            @RequestBody PublicationRequests.Publish request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return ResponseEntity.status(201)
                .body(service.publish(
                        principal.userId(), request.pageId(), request.idempotencyKey()));
    }

    @PostMapping("/unpublish")
    ResponseEntity<Void> unpublish(
            @RequestBody PublicationRequests.Page request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.unpublish(principal.userId(), request.pageId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/publication-state")
    PublicationState state(
            @RequestBody PublicationRequests.Page request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.state(principal.userId(), request.pageId());
    }

    @PostMapping("/publication-history")
    List<PagePublicationView> history(
            @RequestBody PublicationRequests.History request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.history(
                principal.userId(),
                request.pageId(),
                request.limit() == null ? 50 : request.limit());
    }

    @PostMapping("/publication-history/page")
    PublicationHistoryPageView historyPage(
            @RequestBody PublicationRequests.History request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.historyPage(
                principal.userId(),
                request.pageId(),
                request.limit() == null ? 30 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }
}
