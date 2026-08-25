package io.knowledge.platform.identity;

import java.util.List;

public record InstanceUserPageView(
        List<InstanceUserView> items,
        int nextOffset,
        boolean hasMore) {}
