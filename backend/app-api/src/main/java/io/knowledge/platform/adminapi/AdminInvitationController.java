package io.knowledge.platform.adminapi;

import io.knowledge.platform.invitation.CreateInvitationCommand;
import io.knowledge.platform.invitation.InvitationService;
import io.knowledge.platform.invitation.InvitationView;
import io.knowledge.platform.invitation.InvitationPageView;
import io.knowledge.platform.invitation.InvitationKnowledgeBaseTarget;
import io.knowledge.platform.security.PlatformPrincipal;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/invitations")
final class AdminInvitationController {

    private final InvitationService invitationService;

    AdminInvitationController(InvitationService invitationService) {
        this.invitationService = invitationService;
    }

    @PostMapping("/list")
    List<InvitationView> list(@Valid @RequestBody InvitationListRequest request) {
        return invitationService.list(
                request.workspaceId(), request.limit() == null ? 100 : request.limit());
    }

    @PostMapping("/page")
    InvitationPageView page(@Valid @RequestBody InvitationListRequest request) {
        return invitationService.page(
                request.workspaceId(),
                request.limit() == null ? 30 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }

    @PostMapping("/create")
    ResponseEntity<InvitationView> create(
            @Valid @RequestBody CreateInvitationRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        int expiresInHours = request.expiresInHours() == null ? 168 : request.expiresInHours();
        InvitationView invitation = invitationService.create(new CreateInvitationCommand(
                request.workspaceId(),
                request.email(),
                request.workspaceRole(),
                request.targetTeamIds() == null ? List.of() : request.targetTeamIds(),
                request.targetKnowledgeBaseRoles() == null
                        ? List.of()
                        : request.targetKnowledgeBaseRoles().stream()
                                .map(value -> new InvitationKnowledgeBaseTarget(
                                        value.knowledgeBaseId(), value.role()))
                                .toList(),
                expiresInHours,
                principal.userId()));
        return ResponseEntity.accepted().body(invitation);
    }

    @PostMapping("/resend")
    ResponseEntity<InvitationView> resend(
            @Valid @RequestBody InvitationIdRequest request) {
        return ResponseEntity.accepted()
                .body(invitationService.resend(request.invitationId()));
    }

    @PostMapping("/revoke")
    ResponseEntity<Void> revoke(
            @Valid @RequestBody InvitationIdRequest request) {
        invitationService.revoke(request.invitationId());
        return ResponseEntity.noContent().build();
    }
}
