package io.knowledge.platform.accountapi;

import io.knowledge.platform.identity.AccountView;
import io.knowledge.platform.identity.AccountSessionView;
import io.knowledge.platform.identity.IdentityAccountManagement;
import io.knowledge.platform.identity.IdentitySessionManagement;
import io.knowledge.platform.collaboration.CollaborationSessionService;
import io.knowledge.platform.security.PlatformPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PathVariable;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/account")
final class AccountController {

    private final IdentityAccountManagement accounts;
    private final IdentitySessionManagement sessions;
    private final CollaborationSessionService collaborationSessions;

    AccountController(
            IdentityAccountManagement accounts,
            IdentitySessionManagement sessions,
            CollaborationSessionService collaborationSessions) {
        this.accounts = accounts;
        this.sessions = sessions;
        this.collaborationSessions = collaborationSessions;
    }

    @GetMapping
    AccountView account(@AuthenticationPrincipal PlatformPrincipal principal) {
        return accounts.get(principal.userId());
    }

    @PostMapping("/profile")
    AccountView updateProfile(
            @Valid @RequestBody ProfileRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return accounts.updateDisplayName(principal.userId(), request.displayName());
    }

    @PostMapping("/password")
    ResponseEntity<Void> changePassword(
            @Valid @RequestBody PasswordRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal,
            HttpServletRequest servletRequest) {
        accounts.changePassword(
                principal.userId(), request.currentPassword(), request.newPassword(),
                request.passwordConfirmation());
        sessions.revokeOthers(principal.userId(), requireSession(servletRequest).getId());
        collaborationSessions.revokeOthers(
                principal.userId(), requireSession(servletRequest).getId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/sessions")
    List<AccountSessionView> sessions(
            @AuthenticationPrincipal PlatformPrincipal principal,
            HttpServletRequest servletRequest) {
        return sessions.list(principal.userId(), requireSession(servletRequest).getId());
    }

    @PostMapping("/sessions/{sessionId}/revoke")
    ResponseEntity<Void> revokeSession(
            @PathVariable UUID sessionId,
            @AuthenticationPrincipal PlatformPrincipal principal,
            HttpServletRequest servletRequest) {
        var currentSession = requireSession(servletRequest);
        boolean current = sessions.revoke(
                principal.userId(), sessionId, currentSession.getId());
        if (current) {
            collaborationSessions.revoke(currentSession.getId());
            currentSession.invalidate();
        }
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/sessions/revoke-others")
    ResponseEntity<Void> revokeOtherSessions(
            @AuthenticationPrincipal PlatformPrincipal principal,
            HttpServletRequest servletRequest) {
        String sessionId = requireSession(servletRequest).getId();
        sessions.revokeOthers(principal.userId(), sessionId);
        collaborationSessions.revokeOthers(principal.userId(), sessionId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/sessions/revoke-all")
    ResponseEntity<Void> revokeAllSessions(
            @AuthenticationPrincipal PlatformPrincipal principal,
            HttpServletRequest servletRequest) {
        var currentSession = requireSession(servletRequest);
        sessions.revokeAll(principal.userId());
        collaborationSessions.revokeAll(principal.userId());
        currentSession.invalidate();
        return ResponseEntity.noContent().build();
    }

    private static jakarta.servlet.http.HttpSession requireSession(
            HttpServletRequest request) {
        var session = request.getSession(false);
        if (session == null) throw new IllegalStateException("Authenticated HTTP session is missing");
        return session;
    }

    record ProfileRequest(@Size(max = 200) String displayName) {}

    record PasswordRequest(
            @NotBlank @Size(max = 128) String currentPassword,
            @NotBlank @Size(min = 10, max = 128) String newPassword,
            @NotBlank @Size(min = 10, max = 128) String passwordConfirmation) {}
}
