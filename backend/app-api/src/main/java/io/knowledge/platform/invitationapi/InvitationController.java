package io.knowledge.platform.invitationapi;

import io.knowledge.platform.invitation.AcceptedInvitation;
import io.knowledge.platform.invitation.InvitationService;
import io.knowledge.platform.invitation.ResolvedInvitation;
import io.knowledge.platform.security.SessionSecurityService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/invitations")
class InvitationController {

    private final InvitationService invitationService;
    private final SessionSecurityService sessionSecurityService;

    InvitationController(
            InvitationService invitationService,
            SessionSecurityService sessionSecurityService) {
        this.invitationService = invitationService;
        this.sessionSecurityService = sessionSecurityService;
    }

    @GetMapping("/resolve")
    ResolvedInvitation resolve(
            @RequestParam @Size(min = 32, max = 256) String token) {
        return invitationService.resolve(token);
    }

    @PostMapping("/accept")
    ResponseEntity<Map<String, Object>> accept(
            @Valid @RequestBody AcceptInvitationRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse) {
        AcceptedInvitation accepted = invitationService.accept(
                request.token(), request.password(), request.passwordConfirmation());
        sessionSecurityService.establish(
                accepted.identity(), servletRequest, servletResponse);
        return ResponseEntity.ok(Map.of(
                "invitationId", accepted.invitationId(),
                "workspaceId", accepted.workspaceId()));
    }
}
