package io.knowledge.platform.engagement;

import java.util.List;

public record CommentPageView(
        List<CommentView> items,
        int nextOffset,
        boolean hasMore) {}
