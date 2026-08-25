package io.knowledge.platform.template;

import java.util.List;

public record TemplatePageView(List<TemplateView> items,int nextOffset,boolean hasMore) {}
