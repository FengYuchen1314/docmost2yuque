package io.knowledge.platform.pageapi;

import io.knowledge.platform.page.CreatePageCommand;
import io.knowledge.platform.page.PageHistoryView;
import io.knowledge.platform.page.PageHistoryPageView;
import io.knowledge.platform.page.PageLabelService;
import io.knowledge.platform.page.PageLabelsView;
import io.knowledge.platform.page.PageService;
import io.knowledge.platform.page.PageView;
import io.knowledge.platform.page.TrashPageView;
import io.knowledge.platform.page.UpdatePageCommand;
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
final class PageController {

    private final PageService service;
    private final PageLabelService labels;

    PageController(PageService service, PageLabelService labels) {
        this.service = service;
        this.labels = labels;
    }

    @PostMapping("/get")
    PageView get(
            @RequestBody PageRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.get(principal.userId(), request.pageId());
    }

    @PostMapping("/list")
    List<PageView> list(
            @RequestBody PageRequests.ListPages request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.list(principal.userId(), request.knowledgeBaseId());
    }

    @PostMapping("/create")
    ResponseEntity<PageView> create(
            @RequestBody PageRequests.Create request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        PageView page = service.create(
                principal.userId(),
                new CreatePageCommand(
                        request.knowledgeBaseId(),
                        request.title(),
                        request.path(),
                        request.contentType(),
                        request.icon(),
                        request.cover(),
                        request.publishMode(),
                        request.visibilityOverride(),
                        request.documentSettings(),
                        request.content()));
        return ResponseEntity.status(201).body(page);
    }

    @PostMapping("/update")
    PageView update(
            @RequestBody PageRequests.Update request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.update(
                principal.userId(),
                new UpdatePageCommand(
                        request.pageId(),
                        request.expectedRevision(),
                        request.title(),
                        request.path(),
                        request.icon(),
                        request.cover(),
                        request.publishMode(),
                        request.visibilityOverride(),
                        request.documentSettings(),
                        request.content(),
                        request.schemaVersion(),
                        request.revisionKind(),
                        request.revisionDescription()));
    }

    @PostMapping("/trash")
    ResponseEntity<Void> trash(
            @RequestBody PageRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.moveToTrash(principal.userId(), request.pageId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/trash/list")
    List<PageView> trashList(
            @RequestBody PageRequests.Workspace request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.trash(principal.userId(), request.workspaceId());
    }

    @PostMapping("/trash/page")
    TrashPageView globalTrash(
            @RequestBody PageRequests.TrashPage request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.globalTrash(
                principal.userId(),
                request.query(),
                request.offset() == null ? 0 : request.offset(),
                request.limit() == null ? 25 : request.limit());
    }

    @PostMapping("/restore")
    PageView restore(
            @RequestBody PageRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.restore(principal.userId(), request.pageId());
    }

    @PostMapping("/restore-batch")
    List<PageView> restoreBatch(
            @RequestBody PageRequests.Ids request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.restoreBatch(principal.userId(), request.pageIds());
    }

    @PostMapping("/delete-permanently")
    ResponseEntity<Void> deletePermanently(
            @RequestBody PageRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.permanentlyDelete(principal.userId(), request.pageId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/delete-permanently-batch")
    ResponseEntity<Void> deletePermanentlyBatch(
            @RequestBody PageRequests.Ids request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.permanentlyDeleteBatch(principal.userId(), request.pageIds());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/history")
    List<PageHistoryView> history(
            @RequestBody PageRequests.History request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.history(
                principal.userId(),
                request.pageId(),
                request.limit() == null ? 100 : request.limit());
    }

    @PostMapping("/history/page")
    PageHistoryPageView historyPage(
            @RequestBody PageRequests.History request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.historyPage(
                principal.userId(),
                request.pageId(),
                request.limit() == null ? 30 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }

    @PostMapping("/history/copy")
    ResponseEntity<PageView> copyHistory(
            @RequestBody PageRequests.CopyHistory request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        PageView copy = service.copyHistoryRevision(
                principal.userId(),
                request.pageId(),
                request.revisionNo(),
                request.title(),
                request.path());
        return ResponseEntity.status(201).body(copy);
    }

    @PostMapping("/copy")
    ResponseEntity<PageView> copy(
            @RequestBody PageRequests.Copy request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        PageView copy = service.copyCurrent(
                principal.userId(),
                request.pageId(),
                request.targetKnowledgeBaseId(),
                request.title(),
                request.path());
        return ResponseEntity.status(201).body(copy);
    }

    @PostMapping("/labels")
    PageLabelsView labels(
            @RequestBody PageRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return labels.labels(principal.userId(), request.pageId());
    }

    @PostMapping("/labels/update")
    PageLabelsView updateLabels(
            @RequestBody PageRequests.Labels request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return labels.update(
                principal.userId(),
                request.pageId(),
                request.expectedRevision() == null ? -1 : request.expectedRevision(),
                request.labels());
    }
}
