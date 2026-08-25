package io.knowledge.platform.collaborationapi;

import io.knowledge.platform.collaboration.CollaborationTicketService;
import io.knowledge.platform.collaboration.CollaborationTicketView;
import io.knowledge.platform.security.PlatformPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/collaboration")
final class CollaborationController {

    private final CollaborationTicketService service;

    CollaborationController(CollaborationTicketService service) {
        this.service = service;
    }

    @PostMapping("/ticket")
    CollaborationTicketView issue(
            @RequestBody TicketRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal,
            HttpServletRequest servletRequest) {
        var session = servletRequest.getSession(false);
        if (session == null) {
            throw new IllegalStateException("Authenticated HTTP session is missing");
        }
        return service.issue(principal.userId(), request.pageId(), session.getId());
    }

    record TicketRequest(UUID pageId) {}
}
