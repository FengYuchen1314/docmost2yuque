package io.knowledge.platform.publicationapi;

import io.knowledge.platform.publication.DatabaseFormService;
import io.knowledge.platform.publication.DatabaseFormSubmissionView;
import io.knowledge.platform.security.PlatformPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/public/v1/database-forms")
final class DatabaseFormController {

    private final DatabaseFormService service;

    DatabaseFormController(DatabaseFormService service) {
        this.service = service;
    }

    @PostMapping("/submit")
    ResponseEntity<DatabaseFormSubmissionView> submit(
            @RequestBody PublicationRequests.DatabaseFormSubmit request,
            @AuthenticationPrincipal PlatformPrincipal principal,
            HttpServletRequest servletRequest) {
        DatabaseFormSubmissionView result = service.submit(
                principal == null ? null : principal.userId(),
                request.publicationId(),
                request.idempotencyKey(),
                request.values(),
                fingerprint(servletRequest));
        return ResponseEntity.status(result.duplicate() ? 200 : 201).body(result);
    }

    private static String fingerprint(HttpServletRequest request) {
        String address = request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
        String agent = request.getHeader("User-Agent");
        if (agent == null) agent = "unknown";
        return address + "|" + agent.substring(0, Math.min(agent.length(), 500));
    }
}
