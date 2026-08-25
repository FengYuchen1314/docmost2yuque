package io.knowledge.platform.authapi;

import io.knowledge.platform.identity.AuthenticatedIdentity;
import io.knowledge.platform.identity.IdentityAccountManagement;
import io.knowledge.platform.authentication.PasswordAuthenticationService;
import io.knowledge.platform.security.SessionSecurityService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.Map;
import java.util.LinkedHashMap;

@RestController
@RequestMapping("/api/v1/auth")
final class AuthenticationController {

    private final PasswordAuthenticationService passwordAuthentication;
    private final IdentityAccountManagement accountManagement;
    private final SessionSecurityService sessionSecurityService;

    AuthenticationController(
            PasswordAuthenticationService passwordAuthentication,
            IdentityAccountManagement accountManagement,
            SessionSecurityService sessionSecurityService) {
        this.passwordAuthentication = passwordAuthentication;
        this.accountManagement = accountManagement;
        this.sessionSecurityService = sessionSecurityService;
    }

    @GetMapping("/me")
    Map<String, Object> me(@AuthenticationPrincipal PlatformPrincipal principal) {
        var account = accountManagement.get(principal.userId());
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("userId", principal.userId());
        response.put("email", principal.email());
        response.put("displayName", account.displayName());
        response.put("instanceAdmin", principal.instanceAdmin());
        return response;
    }

    @PostMapping("/login/password")
    ResponseEntity<Void> passwordLogin(
            @Valid @RequestBody PasswordLoginRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse) {
        AuthenticatedIdentity identity = passwordAuthentication.authenticate(
                request.email(), request.password(), servletRequest.getRemoteAddr());
        sessionSecurityService.establish(identity, servletRequest, servletResponse);
        return ResponseEntity.noContent().build();
    }
}
