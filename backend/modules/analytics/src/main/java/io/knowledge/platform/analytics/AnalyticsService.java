package io.knowledge.platform.analytics;

import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceType;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AnalyticsService {
    private final AnalyticsRepository repository;
    private final AuthorizationService authorization;

    public AnalyticsService(AnalyticsRepository repository, AuthorizationService authorization) {
        this.repository = repository; this.authorization = authorization;
    }

    @Transactional(readOnly = true)
    public AnalyticsReport page(UUID actorId, UUID pageId, LocalDate from, LocalDate to) {
        var decision = authorization.require(actorId, ResourceType.PAGE, pageId, Capability.VIEW_ANALYTICS);
        var range = range(from, to);
        return report("PAGE", pageId, range[0], range[1], repository.pageMetrics(decision.workspaceId(), pageId, range[0], range[1]));
    }

    @Transactional(readOnly = true)
    public AnalyticsReport knowledgeBase(UUID actorId, UUID knowledgeBaseId, LocalDate from, LocalDate to) {
        var decision = authorization.require(actorId, ResourceType.KNOWLEDGE_BASE, knowledgeBaseId, Capability.VIEW_ANALYTICS);
        var range = range(from, to);
        return report("KNOWLEDGE_BASE", knowledgeBaseId, range[0], range[1], repository.knowledgeBaseMetrics(decision.workspaceId(), knowledgeBaseId, range[0], range[1]));
    }

    public String csv(AnalyticsReport report) {
        StringBuilder output = new StringBuilder("date,views,unique_views,edits,comments,shares,exports,reactions\n");
        for (DailyMetricView item : report.daily()) output.append(item.date()).append(',').append(item.views()).append(',').append(item.uniqueViews()).append(',').append(item.edits()).append(',').append(item.comments()).append(',').append(item.shares()).append(',').append(item.exports()).append(',').append(item.reactions()).append('\n');
        return output.toString();
    }

    private static AnalyticsReport report(String type, UUID id, LocalDate from, LocalDate to, List<DailyMetricView> daily) {
        DailyMetricView totals = new DailyMetricView(null,
                daily.stream().mapToLong(DailyMetricView::views).sum(), daily.stream().mapToLong(DailyMetricView::uniqueViews).sum(),
                daily.stream().mapToLong(DailyMetricView::edits).sum(), daily.stream().mapToLong(DailyMetricView::comments).sum(),
                daily.stream().mapToLong(DailyMetricView::shares).sum(), daily.stream().mapToLong(DailyMetricView::exports).sum(),
                daily.stream().mapToLong(DailyMetricView::reactions).sum());
        return new AnalyticsReport(type, id, from, to, totals, daily);
    }

    private static LocalDate[] range(LocalDate from, LocalDate to) {
        LocalDate end = to == null ? LocalDate.now(ZoneOffset.UTC) : to;
        LocalDate start = from == null ? end.minusDays(29) : from;
        if (start.isAfter(end) || start.isBefore(end.minusDays(365))) throw new IllegalArgumentException("Analytics range must be between 1 and 366 days");
        return new LocalDate[] {start, end};
    }
}
