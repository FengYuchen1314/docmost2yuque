package io.knowledge.platform.page;

import java.util.List;
import java.util.UUID;

public record PageLabelsView(UUID pageId, long revision, List<PageLabelView> labels) {}
