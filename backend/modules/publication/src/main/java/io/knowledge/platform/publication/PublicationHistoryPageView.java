package io.knowledge.platform.publication;

import java.util.List;

public record PublicationHistoryPageView(
        List<PagePublicationView> items,
        int nextOffset,
        boolean hasMore) {}
