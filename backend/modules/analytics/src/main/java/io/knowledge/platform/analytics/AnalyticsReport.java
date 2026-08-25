package io.knowledge.platform.analytics;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record AnalyticsReport(
        String resourceType,
        UUID resourceId,
        LocalDate from,
        LocalDate to,
        DailyMetricView totals,
        List<DailyMetricView> daily) {}
