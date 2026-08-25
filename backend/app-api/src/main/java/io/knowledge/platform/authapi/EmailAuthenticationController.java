package io.knowledge.platform.authapi;

import io.knowledge.platform.authentication.ChallengeAccepted;
import io.knowledge.platform.authentication.CompletedRegistration;
import io.knowledge.platform.authentication.EmailAuthenticationService;
import io.knowledge.platform.identity.AuthenticatedIdentity;
import io.knowledge.platform.security.SessionSecurityService;
import io.knowledge.platform.setup.RegistrationMode;
import io.knowledge.platform.setup.RegistrationSettings;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
class EmailAuthenticationController {

    private final EmailAuthenticationService emailAuthenticationService;
    private final SessionSecurityService sessionSecurityService;

    EmailAuthenticationController(
            EmailAuthenticationService emailAuthenticationService,
            SessionSecurityService sessionSecurityService) {
        this.emailAuthenticationService = emailAuthenticationService;
        this.sessionSecurityService = sessionSecurityService;
    }

    @GetMapping("/registration-status")
    PublicRegistrationStatus registrationStatus() {
        RegistrationSettings settings = emailAuthenticationService.registrationStatus();
        return new PublicRegistrationStatus(
                settings.registrationMode() == RegistrationMode.PUBLIC,
                true,
                settings.passwordLoginEnabled(),
                settings.emailCodeLoginEnabled() && settings.smtpReady());
    }

    @PostMapping("/register/start")
    ResponseEntity<ChallengeAccepted> startRegistration(
            @Valid @RequestBody StartRegistrationRequest request,
            HttpServletRequest servletRequest) {
        ChallengeAccepted challenge = emailAuthenticationService.startPublicRegistration(
                request.email(),
                request.password(),
                request.passwordConfirmation(),
                servletRequest.getRemoteAddr());
        return ResponseEntity.accepted().body(challenge);
    }

    @PostMapping("/register/verify")
    ResponseEntity<Map<String, Object>> verifyRegistration(
            @Valid @RequestBody VerifyRegistrationRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse) {
        CompletedRegistration registration =
                emailAuthenticationService.verifyPublicRegistration(
                        request.challengeId(), request.code());
        sessionSecurityService.establish(
                registration.identity(), servletRequest, servletResponse);
        return ResponseEntity.ok(Map.of(
                "userId", registration.identity().userId(),
                "workspaceId", registration.workspaceId(),
                "email", registration.identity().email()));
    }

    @PostMapping("/login/email-code/request")
    ResponseEntity<Void> requestLoginCode(
            @Valid @RequestBody EmailCodeRequest request,
            HttpServletRequest servletRequest) {
        emailAuthenticationService.requestPasswordlessLogin(
                request.email(), servletRequest.getRemoteAddr());
        return ResponseEntity.accepted().build();
    }

    @PostMapping("/login/email-code/verify")
    ResponseEntity<Void> verifyLoginCode(
            @Valid @RequestBody EmailCodeVerifyRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse) {
        AuthenticatedIdentity identity =
                emailAuthenticationService.verifyPasswordlessLogin(
                        request.email(), request.code());
        sessionSecurityService.establish(identity, servletRequest, servletResponse);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/password-reset/request")
    ResponseEntity<ChallengeAccepted> requestPasswordReset(
            @Valid @RequestBody PasswordResetRequest request,
            HttpServletRequest servletRequest) {
        ChallengeAccepted challenge = emailAuthenticationService.requestPasswordReset(
                request.email(), servletRequest.getRemoteAddr());
        return ResponseEntity.accepted().body(challenge);
    }

    @PostMapping("/password-reset/complete")
    ResponseEntity<Void> completePasswordReset(
            @Valid @RequestBody PasswordResetCompleteRequest request) {
        emailAuthenticationService.completePasswordReset(
                request.challengeId(), request.code(), request.password(),
                request.passwordConfirmation());
        return ResponseEntity.noContent().build();
    }
}
