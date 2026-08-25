package io.knowledge.platform.analytics;

import java.time.LocalDate;

public record DailyMetricView(
        LocalDate date,
        long views,
        long uniqueViews,
        long edits,
        long comments,
        long shares,
        long exports,
        long reactions) {}
