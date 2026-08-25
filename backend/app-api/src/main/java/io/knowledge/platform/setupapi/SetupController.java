package io.knowledge.platform.setupapi;

import io.knowledge.platform.identity.AuthenticatedIdentity;
import io.knowledge.platform.security.SessionSecurityService;
import io.knowledge.platform.setup.SetupInitializationRequest;
import io.knowledge.platform.setup.SetupResult;
import io.knowledge.platform.setup.SetupService;
import io.knowledge.platform.setup.SetupStatus;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/setup")
final class SetupController {

    private final SetupService setupService;
    private final SessionSecurityService sessionSecurityService;

    SetupController(SetupService setupService, SessionSecurityService sessionSecurityService) {
        this.setupService = setupService;
        this.sessionSecurityService = sessionSecurityService;
    }

    @GetMapping("/status")
    SetupStatus status() {
        return setupService.status();
    }

    @PostMapping("/initialize")
    ResponseEntity<SetupResult> initialize(
            @Valid @RequestBody SetupInitializationRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse) {
        SetupResult result = setupService.initialize(
                request.email(),
                request.password(),
                request.passwordConfirmation(),
                request.workspaceName());
        sessionSecurityService.establish(
                new AuthenticatedIdentity(result.userId(), result.email(), true),
                servletRequest,
                servletResponse);
        return ResponseEntity.created(URI.create("/api/v1/workspaces/" + result.workspaceId()))
                .body(result);
    }
}
