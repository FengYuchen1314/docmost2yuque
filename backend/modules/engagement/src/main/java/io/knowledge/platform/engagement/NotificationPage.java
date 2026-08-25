package io.knowledge.platform.engagement;

import java.util.List;

public record NotificationPage(List<NotificationView> items, int nextOffset, boolean hasMore) {}
