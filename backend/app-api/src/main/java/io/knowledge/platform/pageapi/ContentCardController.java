package io.knowledge.platform.pageapi;

import io.knowledge.platform.page.CheckinStateView;
import io.knowledge.platform.page.ContentCardDefinitionView;
import io.knowledge.platform.page.ContentCardInstanceView;
import io.knowledge.platform.page.ContentCardService;
import io.knowledge.platform.page.PollStateView;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/content-cards")
final class ContentCardController {

    private final ContentCardService service;

    ContentCardController(ContentCardService service) {
        this.service = service;
    }

    @PostMapping("/definitions")
    List<ContentCardDefinitionView> definitions(
            @RequestBody ContentCardRequests.Page request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.definitions(principal.userId(), request.pageId());
    }

    @PostMapping("/recent")
    List<ContentCardDefinitionView> recent(
            @RequestBody ContentCardRequests.Page request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.recent(principal.userId(), request.pageId());
    }

    @PostMapping("/use")
    ResponseEntity<Void> recordUsage(
            @RequestBody ContentCardRequests.Usage request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.recordUsage(principal.userId(), request.pageId(), request.cardId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/instance")
    ContentCardInstanceView instance(
            @RequestBody ContentCardRequests.Instance request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.instance(principal.userId(), request.instanceId());
    }

    @PostMapping("/poll/state")
    PollStateView pollState(
            @RequestBody ContentCardRequests.Instance request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.pollState(principal.userId(), request.instanceId());
    }

    @PostMapping("/poll/vote")
    PollStateView vote(
            @RequestBody ContentCardRequests.Vote request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.vote(
                principal.userId(), request.instanceId(), request.optionIds());
    }

    @PostMapping("/checkin/state")
    CheckinStateView checkinState(
            @RequestBody ContentCardRequests.Instance request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.checkinState(principal.userId(), request.instanceId());
    }

    @PostMapping("/checkin")
    CheckinStateView checkin(
            @RequestBody ContentCardRequests.Checkin request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.checkin(
                principal.userId(), request.instanceId(), request.localDate());
    }
}
