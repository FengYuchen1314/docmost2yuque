package io.knowledge.platform.page;

import java.util.List;

public record PageHistoryPageView(
        List<PageHistoryView> items,
        int nextOffset,
        boolean hasMore) {}
