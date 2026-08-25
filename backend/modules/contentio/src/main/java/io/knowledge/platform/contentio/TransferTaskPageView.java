package io.knowledge.platform.contentio;

import java.util.List;

public record TransferTaskPageView(
        List<TransferTaskView> items,
        int nextOffset,
        boolean hasMore) {}
