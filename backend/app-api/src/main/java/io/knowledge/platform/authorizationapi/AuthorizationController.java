package io.knowledge.platform.authorizationapi;

import io.knowledge.platform.authorization.AclEntryView;
import io.knowledge.platform.authorization.AuthorizationDecision;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.UpsertAclCommand;
import io.knowledge.platform.security.PlatformPrincipal;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Set;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/authorization")
final class AuthorizationController {

    private final AuthorizationService authorizationService;

    AuthorizationController(AuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    @PostMapping("/resolve")
    AuthorizationDecision resolve(
            @Valid @RequestBody AuthorizationRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return authorizationService.resolve(
                principal.userId(), request.resourceType(), request.resourceId());
    }

    @PostMapping("/list")
    List<AclEntryView> list(
            @Valid @RequestBody AuthorizationRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return authorizationService.list(
                principal.userId(), request.resourceType(), request.resourceId());
    }

    @PostMapping("/grant")
    ResponseEntity<AclEntryView> grant(
            @Valid @RequestBody GrantAclRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        AclEntryView entry = authorizationService.grant(
                principal.userId(),
                new UpsertAclCommand(
                        request.resourceType(),
                        request.resourceId(),
                        request.subjectType(),
                        request.subjectId(),
                        request.role(),
                        request.effect(),
                        request.capabilities() == null ? Set.of() : request.capabilities()));
        return ResponseEntity.status(201).body(entry);
    }

    @PostMapping("/revoke")
    ResponseEntity<Void> revoke(
            @Valid @RequestBody RevokeAclRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        authorizationService.revoke(principal.userId(), request.aclEntryId());
        return ResponseEntity.noContent().build();
    }
}
