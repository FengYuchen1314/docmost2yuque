package io.knowledge.platform.workspaceapi;

import io.knowledge.platform.security.PlatformPrincipal;
import io.knowledge.platform.workspace.WorkspaceManagementService;
import io.knowledge.platform.workspace.WorkspaceMemberView;
import io.knowledge.platform.workspace.WorkspaceView;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/workspaces")
final class WorkspaceController {

    private final WorkspaceManagementService service;

    WorkspaceController(WorkspaceManagementService service) {
        this.service = service;
    }

    @GetMapping
    List<WorkspaceView> list(@AuthenticationPrincipal PlatformPrincipal principal) {
        return service.list(principal.userId());
    }

    @PostMapping("/create")
    ResponseEntity<WorkspaceView> create(
            @RequestBody WorkspaceRequests.Create request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return ResponseEntity.status(201)
                .body(service.createOrganization(principal.userId(), request.name()));
    }

    @PostMapping("/update")
    WorkspaceView update(
            @RequestBody WorkspaceRequests.Update request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.update(
                principal.userId(),
                request.workspaceId(),
                request.name(),
                request.defaultVisibility(),
                request.defaultPublishMode());
    }

    @PostMapping("/delete")
    ResponseEntity<Void> delete(
            @RequestBody WorkspaceRequests.Archive request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.archive(principal.userId(), request.workspaceId(), request.confirmationName());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/members")
    List<WorkspaceMemberView> members(
            @RequestBody WorkspaceRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.members(principal.userId(), request.workspaceId());
    }

    @PostMapping("/members/update")
    List<WorkspaceMemberView> updateMember(
            @RequestBody WorkspaceRequests.Member request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.updateMember(
                principal.userId(),
                request.workspaceId(),
                request.userId(),
                request.role());
    }

    @PostMapping("/members/remove")
    ResponseEntity<Void> removeMember(
            @RequestBody WorkspaceRequests.Member request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.removeMember(
                principal.userId(), request.workspaceId(), request.userId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/ownership/transfer")
    List<WorkspaceMemberView> transferOwnership(
            @RequestBody WorkspaceRequests.TransferOwnership request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.transferOwnership(
                principal.userId(),
                request.workspaceId(),
                request.targetUserId(),
                request.confirmationName());
    }
}
