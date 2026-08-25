package io.knowledge.platform.page;

import java.util.List;

public record TrashPageView(List<TrashItemView> items, int nextOffset, boolean hasMore) {}
