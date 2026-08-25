package io.knowledge.platform.social;

import java.util.List;

public record SocialPageView<T>(List<T> items,int nextOffset,boolean hasMore) {}
