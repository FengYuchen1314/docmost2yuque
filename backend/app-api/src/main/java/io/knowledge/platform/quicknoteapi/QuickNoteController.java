package io.knowledge.platform.quicknoteapi;

import io.knowledge.platform.page.PageView;
import io.knowledge.platform.quicknote.QuickNoteRevisionView;
import io.knowledge.platform.quicknote.QuickNoteHistoryPageView;
import io.knowledge.platform.quicknote.QuickNotePageView;
import io.knowledge.platform.quicknote.QuickNoteService;
import io.knowledge.platform.quicknote.QuickNoteTagView;
import io.knowledge.platform.quicknote.QuickNoteView;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/quick-notes", "/api/v1/quick-notes"})
final class QuickNoteController {

    private final QuickNoteService service;

    QuickNoteController(QuickNoteService service) {
        this.service = service;
    }

    @PostMapping("/list")
    List<QuickNoteView> list(
            @RequestBody QuickNoteRequests.ListNotes request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.list(
                principal.userId(), request.status(), request.tagId(), request.query(),
                request.limit() == null ? 50 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }

    @PostMapping("/page")
    QuickNotePageView page(@RequestBody QuickNoteRequests.ListNotes request,@AuthenticationPrincipal PlatformPrincipal principal){return service.page(principal.userId(),request.status(),request.tagId(),request.query(),request.limit()==null?30:request.limit(),request.offset()==null?0:request.offset());}

    @PostMapping("/create")
    ResponseEntity<QuickNoteView> create(
            @RequestBody QuickNoteRequests.Create request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        QuickNoteView result = service.create(
                principal.userId(), request.workspaceId(), request.content(), request.plainText(),
                request.source(), request.clientRequestId(), request.tagIds());
        return ResponseEntity.status(201).body(result);
    }

    @PostMapping("/save")
    QuickNoteView save(
            @RequestBody QuickNoteRequests.Save request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.save(
                principal.userId(), request.quickNoteId(), request.expectedRevision(),
                request.content(), request.plainText(), request.kind());
    }

    @PostMapping("/archive")
    QuickNoteView archive(
            @RequestBody QuickNoteRequests.Archive request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.archive(principal.userId(), request.quickNoteId(), request.archived());
    }

    @PostMapping("/delete")
    ResponseEntity<Void> delete(
            @RequestBody QuickNoteRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.delete(principal.userId(), request.quickNoteId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/restore")
    QuickNoteView restore(
            @RequestBody QuickNoteRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.restore(principal.userId(), request.quickNoteId());
    }

    @PostMapping("/batch")
    List<QuickNoteView> batch(
            @RequestBody QuickNoteRequests.Batch request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.batch(
                principal.userId(), request.quickNoteIds(), request.operation(), request.tagIds());
    }

    @PostMapping("/merge")
    PageView merge(
            @RequestBody QuickNoteRequests.Convert request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.convert(
                principal.userId(), request.quickNoteIds(), request.knowledgeBaseId(),
                request.title(), request.path());
    }

    @PostMapping("/convert")
    PageView convert(
            @RequestBody QuickNoteRequests.Convert request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.convert(
                principal.userId(), request.quickNoteIds(), request.knowledgeBaseId(),
                request.title(), request.path());
    }

    @PostMapping("/history")
    List<QuickNoteRevisionView> history(
            @RequestBody QuickNoteRequests.History request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.history(
                principal.userId(), request.quickNoteId(),
                request.limit() == null ? 100 : request.limit());
    }

    @PostMapping("/history/page")
    QuickNoteHistoryPageView historyPage(
            @RequestBody QuickNoteRequests.History request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.historyPage(
                principal.userId(),
                request.quickNoteId(),
                request.limit() == null ? 30 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }

    @PostMapping("/history/restore")
    QuickNoteView restoreRevision(
            @RequestBody QuickNoteRequests.RestoreRevision request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.restoreRevision(
                principal.userId(), request.quickNoteId(), request.revision());
    }

    @PostMapping("/tags/list")
    List<QuickNoteTagView> tags(@AuthenticationPrincipal PlatformPrincipal principal) {
        return service.tags(principal.userId());
    }

    @PostMapping("/tags/create")
    ResponseEntity<QuickNoteTagView> createTag(
            @RequestBody QuickNoteRequests.TagCreate request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return ResponseEntity.status(201)
                .body(service.createTag(principal.userId(), request.name(), request.color()));
    }

    @PostMapping("/tags/update")
    QuickNoteTagView updateTag(
            @RequestBody QuickNoteRequests.TagUpdate request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.updateTag(
                principal.userId(), request.tagId(), request.name(), request.color());
    }

    @PostMapping("/tags/delete")
    ResponseEntity<Void> deleteTag(
            @RequestBody QuickNoteRequests.TagDelete request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.deleteTag(principal.userId(), request.tagId());
        return ResponseEntity.noContent().build();
    }
}
