package io.knowledge.platform.analyticsapi;

import io.knowledge.platform.analytics.AnalyticsReport;
import io.knowledge.platform.analytics.AnalyticsService;
import io.knowledge.platform.security.PlatformPrincipal;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/analytics")
final class AnalyticsController {
    private final AnalyticsService service;
    AnalyticsController(AnalyticsService service) { this.service = service; }

    @PostMapping("/page")
    AnalyticsReport page(@RequestBody AnalyticsRequests.Page request, @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.page(principal.userId(), request.pageId(), request.from(), request.to());
    }

    @PostMapping("/knowledge-base")
    AnalyticsReport knowledgeBase(@RequestBody AnalyticsRequests.KnowledgeBase request, @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.knowledgeBase(principal.userId(), request.knowledgeBaseId(), request.from(), request.to());
    }

    @PostMapping(value = "/page/export", produces = "text/csv")
    ResponseEntity<String> exportPage(@RequestBody AnalyticsRequests.Page request, @AuthenticationPrincipal PlatformPrincipal principal) {
        return csv(service.page(principal.userId(), request.pageId(), request.from(), request.to()));
    }

    @PostMapping(value = "/knowledge-base/export", produces = "text/csv")
    ResponseEntity<String> exportKnowledgeBase(@RequestBody AnalyticsRequests.KnowledgeBase request, @AuthenticationPrincipal PlatformPrincipal principal) {
        return csv(service.knowledgeBase(principal.userId(), request.knowledgeBaseId(), request.from(), request.to()));
    }

    private ResponseEntity<String> csv(AnalyticsReport report) {
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=analytics-" + report.resourceId() + ".csv")
                .body(service.csv(report));
    }
}
