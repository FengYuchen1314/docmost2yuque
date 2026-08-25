package io.knowledge.platform.engagementapi;

import io.knowledge.platform.engagement.KnowledgeBaseGroupService;
import io.knowledge.platform.engagement.KnowledgeBaseGroupView;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/knowledge-base-groups")
final class KnowledgeBaseGroupController {

    private final KnowledgeBaseGroupService service;

    KnowledgeBaseGroupController(KnowledgeBaseGroupService service) {
        this.service = service;
    }

    @PostMapping("/list")
    List<KnowledgeBaseGroupView> list(
            @RequestBody KnowledgeBaseGroupRequests.Workspace request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.list(principal.userId(), request.workspaceId());
    }

    @PostMapping("/create")
    ResponseEntity<KnowledgeBaseGroupView> create(
            @RequestBody KnowledgeBaseGroupRequests.Create request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return ResponseEntity.status(201)
                .body(service.create(principal.userId(), request.workspaceId(), request.name()));
    }

    @PostMapping("/rename")
    KnowledgeBaseGroupView rename(
            @RequestBody KnowledgeBaseGroupRequests.Rename request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.rename(principal.userId(), request.groupId(), request.name());
    }

    @PostMapping("/delete")
    ResponseEntity<Void> delete(
            @RequestBody KnowledgeBaseGroupRequests.Group request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.delete(principal.userId(), request.groupId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/reorder")
    List<KnowledgeBaseGroupView> reorder(
            @RequestBody KnowledgeBaseGroupRequests.Reorder request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.reorder(
                principal.userId(), request.workspaceId(), request.orderedGroupIds());
    }

    @PostMapping("/items/move")
    KnowledgeBaseGroupView moveItem(
            @RequestBody KnowledgeBaseGroupRequests.MoveItem request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.moveKnowledgeBase(
                principal.userId(), request.groupId(), request.knowledgeBaseId());
    }

    @PostMapping("/items/remove")
    ResponseEntity<Void> removeItem(
            @RequestBody KnowledgeBaseGroupRequests.RemoveItem request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.removeKnowledgeBase(principal.userId(), request.knowledgeBaseId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/items/reorder")
    KnowledgeBaseGroupView reorderItems(
            @RequestBody KnowledgeBaseGroupRequests.ReorderItems request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.reorderKnowledgeBases(
                principal.userId(), request.groupId(), request.orderedKnowledgeBaseIds());
    }
}
