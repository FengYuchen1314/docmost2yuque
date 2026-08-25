package io.knowledge.platform.quicknote;

import java.time.OffsetDateTime;
import java.util.UUID;

public record QuickNoteTagView(
        UUID id,
        String name,
        String color,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
