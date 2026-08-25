package io.knowledge.platform.search;

import java.util.List;

public record SearchRebuildPageView(
        List<SearchRebuildView> items,
        int nextOffset,
        boolean hasMore) {}
