package io.knowledge.platform.audit;

import java.util.List;

public record AuditEventPageView(
        List<AuditEventView> items,
        int nextOffset,
        boolean hasMore) {}
