package io.knowledge.platform.auditapi;

import io.knowledge.platform.audit.AuditEventView;
import io.knowledge.platform.audit.AuditEventPageView;
import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/audit")
final class AuditController {

    private final AuditService auditService;
    private final AuthorizationService authorization;

    AuditController(AuditService auditService, AuthorizationService authorization) {
        this.auditService = auditService;
        this.authorization = authorization;
    }

    @PostMapping("/list")
    List<AuditEventView> list(
            @RequestBody AuditListRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        authorization.require(
                principal.userId(),
                ResourceType.WORKSPACE,
                request.workspaceId(),
                Capability.MANAGE);
        return auditService.list(
                request.workspaceId(), request.limit() == null ? 100 : request.limit());
    }

    @PostMapping("/page")
    AuditEventPageView page(
            @RequestBody AuditListRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        authorization.require(
                principal.userId(),
                ResourceType.WORKSPACE,
                request.workspaceId(),
                Capability.MANAGE);
        return auditService.page(
                request.workspaceId(),
                request.limit() == null ? 30 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }
}
