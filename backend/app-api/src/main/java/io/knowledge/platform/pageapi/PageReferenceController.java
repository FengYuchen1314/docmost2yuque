package io.knowledge.platform.pageapi;

import io.knowledge.platform.page.EmbeddedPageView;
import io.knowledge.platform.page.KnowledgeGraphView;
import io.knowledge.platform.page.PageReferenceService;
import io.knowledge.platform.page.PageReferenceSummary;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/page-references")
final class PageReferenceController {

    private final PageReferenceService service;

    PageReferenceController(PageReferenceService service) {
        this.service = service;
    }

    @PostMapping("/outgoing")
    List<PageReferenceSummary> outgoing(
            @RequestBody PageReferenceRequests.Page request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.outgoing(principal.userId(), request.pageId());
    }

    @PostMapping("/backlinks")
    List<PageReferenceSummary> backlinks(
            @RequestBody PageReferenceRequests.Page request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.backlinks(principal.userId(), request.pageId());
    }

    @PostMapping("/resolve")
    EmbeddedPageView resolve(
            @RequestBody PageReferenceRequests.Reference request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.resolve(principal.userId(), request.referenceId());
    }

    @PostMapping("/graph")
    KnowledgeGraphView graph(
            @RequestBody PageReferenceRequests.Graph request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.graph(
                principal.userId(),
                request.pageId(),
                request.depth() == null ? 2 : request.depth(),
                request.limit() == null ? 100 : request.limit());
    }
}
