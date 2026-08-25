package io.knowledge.platform.searchapi;

import io.knowledge.platform.search.SearchResponse;
import io.knowledge.platform.search.SearchRebuildPageView;
import io.knowledge.platform.search.SearchRebuildService;
import io.knowledge.platform.search.SearchRebuildView;
import io.knowledge.platform.search.SearchService;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
final class SearchController {

    private final SearchService service;
    private final SearchRebuildService rebuilds;

    SearchController(SearchService service, SearchRebuildService rebuilds) {
        this.service = service;
        this.rebuilds = rebuilds;
    }

    @PostMapping("/api/v1/search")
    SearchResponse search(
            @RequestBody SearchRequests.Internal request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.search(
                principal.userId(),
                request.workspaceId(),
                request.query(),
                request.resourceTypes(),
                request.knowledgeBaseId(),
                request.creatorId(),
                request.updatedFrom(),
                request.updatedTo(),
                request.offset() == null ? 0 : request.offset(),
                request.limit() == null ? 20 : request.limit());
    }

    @PostMapping("/api/public/v1/search")
    SearchResponse publicSearch(@RequestBody SearchRequests.Public request) {
        return service.publicSearch(
                request.workspaceId(),
                request.query(),
                request.offset() == null ? 0 : request.offset(),
                request.limit() == null ? 20 : request.limit());
    }

    @PostMapping("/api/v1/search/rebuild/start")
    SearchRebuildView startRebuild(@RequestBody SearchRequests.RebuildStart request,@AuthenticationPrincipal PlatformPrincipal principal){return rebuilds.start(principal.userId(),request.workspaceId());}
    @PostMapping("/api/v1/search/rebuild/advance")
    SearchRebuildView advanceRebuild(@RequestBody SearchRequests.RebuildTask request,@AuthenticationPrincipal PlatformPrincipal principal){return rebuilds.advance(principal.userId(),request.rebuildId(),request.batchSize()==null?100:request.batchSize());}
    @PostMapping("/api/v1/search/rebuild/pause")
    SearchRebuildView pauseRebuild(@RequestBody SearchRequests.RebuildTask request,@AuthenticationPrincipal PlatformPrincipal principal){return rebuilds.pause(principal.userId(),request.rebuildId());}
    @PostMapping("/api/v1/search/rebuild/resume")
    SearchRebuildView resumeRebuild(@RequestBody SearchRequests.RebuildTask request,@AuthenticationPrincipal PlatformPrincipal principal){return rebuilds.resume(principal.userId(),request.rebuildId());}
    @PostMapping("/api/v1/search/rebuild/get")
    SearchRebuildView getRebuild(@RequestBody SearchRequests.RebuildTask request,@AuthenticationPrincipal PlatformPrincipal principal){return rebuilds.get(principal.userId(),request.rebuildId());}
    @PostMapping("/api/v1/search/rebuild/list")
    List<SearchRebuildView> listRebuilds(@RequestBody SearchRequests.RebuildList request,@AuthenticationPrincipal PlatformPrincipal principal){return rebuilds.list(principal.userId(),request.workspaceId());}
    @PostMapping("/api/v1/search/rebuild/page")
    SearchRebuildPageView pageRebuilds(@RequestBody SearchRequests.RebuildList request,@AuthenticationPrincipal PlatformPrincipal principal){return rebuilds.page(principal.userId(),request.workspaceId(),request.limit()==null?20:request.limit(),request.offset()==null?0:request.offset());}
}
