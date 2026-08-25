package io.knowledge.platform.knowledgebaseapi;

import io.knowledge.platform.knowledgebase.CreateKnowledgeBaseCommand;
import io.knowledge.platform.knowledgebase.KnowledgeBaseMemberView;
import io.knowledge.platform.knowledgebase.KnowledgeBaseMergePlan;
import io.knowledge.platform.knowledgebase.KnowledgeBaseMergeResult;
import io.knowledge.platform.knowledgebase.KnowledgeBaseMergeService;
import io.knowledge.platform.knowledgebase.KnowledgeBaseService;
import io.knowledge.platform.knowledgebase.KnowledgeBaseView;
import io.knowledge.platform.knowledgebase.TransferKnowledgeBaseCommand;
import io.knowledge.platform.knowledgebase.UpdateKnowledgeBaseCommand;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/knowledge-bases")
final class KnowledgeBaseController {

    private final KnowledgeBaseService service;
    private final KnowledgeBaseMergeService mergeService;

    KnowledgeBaseController(
            KnowledgeBaseService service,
            KnowledgeBaseMergeService mergeService) {
        this.service = service;
        this.mergeService = mergeService;
    }

    @PostMapping("/list")
    List<KnowledgeBaseView> list(
            @RequestBody KnowledgeBaseRequests.WorkspaceId request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.list(principal.userId(), request.workspaceId());
    }

    @PostMapping("/get")
    KnowledgeBaseView get(
            @RequestBody KnowledgeBaseRequests.KnowledgeBaseId request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.get(principal.userId(), request.knowledgeBaseId());
    }

    @PostMapping("/create")
    ResponseEntity<KnowledgeBaseView> create(
            @RequestBody KnowledgeBaseRequests.Create request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        KnowledgeBaseView value = service.create(
                principal.userId(),
                new CreateKnowledgeBaseCommand(
                        request.workspaceId(),
                        request.name(),
                        request.slug(),
                        request.description(),
                        request.icon(),
                        request.ownerType(),
                        request.ownerId(),
                        request.visibility(),
                        request.allowPublicIndex(),
                        request.publishMode()));
        return ResponseEntity.status(201).body(value);
    }

    @PostMapping("/update")
    KnowledgeBaseView update(
            @RequestBody KnowledgeBaseRequests.Update request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.update(
                principal.userId(),
                new UpdateKnowledgeBaseCommand(
                        request.knowledgeBaseId(),
                        request.name(),
                        request.slug(),
                        request.description(),
                        request.icon(),
                        request.visibility(),
                        request.allowPublicIndex(),
                        request.publishMode(),
                        request.watermarkConfig(),
                        request.appearanceConfig(),
                        request.catalogConfig(),
                        request.homepagePageId()));
    }

    @PostMapping("/transfer")
    KnowledgeBaseView transfer(
            @RequestBody KnowledgeBaseRequests.Transfer request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.transfer(
                principal.userId(),
                new TransferKnowledgeBaseCommand(
                        request.knowledgeBaseId(), request.ownerType(), request.ownerId()));
    }

    @PostMapping("/archive")
    ResponseEntity<Void> archive(
            @RequestBody KnowledgeBaseRequests.KnowledgeBaseId request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.archive(principal.userId(), request.knowledgeBaseId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/merge/plan")
    KnowledgeBaseMergePlan mergePlan(
            @RequestBody KnowledgeBaseRequests.MergePlan request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return mergeService.plan(
                principal.userId(),
                request.sourceKnowledgeBaseId(),
                request.targetKnowledgeBaseId());
    }

    @PostMapping("/merge/execute")
    KnowledgeBaseMergeResult mergeExecute(
            @RequestBody KnowledgeBaseRequests.MergeExecute request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return mergeService.execute(
                principal.userId(),
                request.sourceKnowledgeBaseId(),
                request.targetKnowledgeBaseId(),
                request.planFingerprint(),
                request.idempotencyKey());
    }

    @PostMapping("/members")
    List<KnowledgeBaseMemberView> members(
            @RequestBody KnowledgeBaseRequests.KnowledgeBaseId request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.members(principal.userId(), request.knowledgeBaseId());
    }

    @PostMapping("/members/upsert")
    List<KnowledgeBaseMemberView> upsertMember(
            @RequestBody KnowledgeBaseRequests.Member request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.upsertMember(
                principal.userId(),
                request.knowledgeBaseId(),
                request.userId(),
                request.role());
    }

    @PostMapping("/members/remove")
    ResponseEntity<Void> removeMember(
            @RequestBody KnowledgeBaseRequests.Member request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.removeMember(
                principal.userId(), request.knowledgeBaseId(), request.userId());
        return ResponseEntity.noContent().build();
    }
}
