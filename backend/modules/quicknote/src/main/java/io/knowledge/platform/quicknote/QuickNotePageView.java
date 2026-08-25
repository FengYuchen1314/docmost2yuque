package io.knowledge.platform.quicknote;

import java.util.List;

public record QuickNotePageView(List<QuickNoteView> items,int nextOffset,boolean hasMore) {}
