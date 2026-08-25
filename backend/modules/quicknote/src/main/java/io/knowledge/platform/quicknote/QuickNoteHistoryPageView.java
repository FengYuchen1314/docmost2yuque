package io.knowledge.platform.quicknote;

import java.util.List;

public record QuickNoteHistoryPageView(
        List<QuickNoteRevisionView> items,
        int nextOffset,
        boolean hasMore) {}
