package io.knowledge.platform.analyticsapi;

import java.time.LocalDate;
import java.util.UUID;

final class AnalyticsRequests {
    private AnalyticsRequests() {}
    record Page(UUID pageId, LocalDate from, LocalDate to) {}
    record KnowledgeBase(UUID knowledgeBaseId, LocalDate from, LocalDate to) {}
}
