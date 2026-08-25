package io.knowledge.platform.catalog;

import java.util.List;

public record CatalogRevisionPageView(
        List<CatalogRevisionView> items,
        int nextOffset,
        boolean hasMore) {}
