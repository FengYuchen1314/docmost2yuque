package io.knowledge.platform.engagement;

import java.util.List;

public record WorkbenchPage(List<WorkbenchItem> items, int nextOffset, boolean hasMore) {}
