package io.knowledge.platform.catalogapi;

import io.knowledge.platform.catalog.CatalogRevisionView;
import io.knowledge.platform.catalog.CatalogRevisionPageView;
import io.knowledge.platform.catalog.CatalogService;
import io.knowledge.platform.catalog.CatalogTreeView;
import io.knowledge.platform.catalog.CreateCatalogNodeCommand;
import io.knowledge.platform.catalog.MoveCatalogNodeCommand;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/catalog")
final class CatalogController {

    private final CatalogService service;

    CatalogController(CatalogService service) {
        this.service = service;
    }

    @PostMapping("/list")
    CatalogTreeView list(
            @RequestBody CatalogRequests.ListTree request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.list(principal.userId(), request.knowledgeBaseId());
    }

    @PostMapping("/create")
    ResponseEntity<CatalogTreeView> create(
            @RequestBody CatalogRequests.Create request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        CatalogTreeView tree = service.create(
                principal.userId(),
                new CreateCatalogNodeCommand(
                        request.knowledgeBaseId(),
                        request.nodeType(),
                        request.pageId(),
                        request.parentId(),
                        request.beforeNodeId(),
                        request.afterNodeId(),
                        request.titleOverride(),
                        request.url(),
                        request.metadata(),
                        request.expectedRevision()));
        return ResponseEntity.status(201).body(tree);
    }

    @PostMapping("/rename")
    CatalogTreeView rename(
            @RequestBody CatalogRequests.Rename request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.rename(
                principal.userId(),
                request.nodeId(),
                request.title(),
                request.expectedRevision());
    }

    @PostMapping("/move")
    CatalogTreeView move(
            @RequestBody CatalogRequests.Move request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.move(
                principal.userId(),
                new MoveCatalogNodeCommand(
                        request.nodeId(),
                        request.targetParentId(),
                        request.beforeNodeId(),
                        request.afterNodeId(),
                        request.expectedRevision()));
    }

    @PostMapping("/remove")
    CatalogTreeView remove(
            @RequestBody CatalogRequests.Remove request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.remove(
                principal.userId(), request.nodeId(), request.expectedRevision());
    }

    @PostMapping("/batch")
    CatalogTreeView batch(
            @RequestBody CatalogRequests.Batch request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.batch(
                principal.userId(),
                request.knowledgeBaseId(),
                request.nodeIds(),
                request.operation(),
                request.targetParentId(),
                request.expectedRevision());
    }

    @PostMapping("/history")
    List<CatalogRevisionView> history(
            @RequestBody CatalogRequests.History request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.history(
                principal.userId(),
                request.knowledgeBaseId(),
                request.limit() == null ? 100 : request.limit());
    }

    @PostMapping("/history/page")
    CatalogRevisionPageView historyPage(
            @RequestBody CatalogRequests.History request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.historyPage(
                principal.userId(),
                request.knowledgeBaseId(),
                request.limit() == null ? 30 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }

    @PostMapping("/restore")
    CatalogTreeView restore(
            @RequestBody CatalogRequests.Restore request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.restore(
                principal.userId(), request.knowledgeBaseId(), request.revisionNo(),
                request.expectedRevision());
    }
}
