package io.knowledge.platform.search;

import java.util.List;

public record SearchResponse(
        List<SearchResultView> results,
        int nextOffset,
        boolean hasMore) {}
