package io.knowledge.platform.page;

import java.time.OffsetDateTime;
import java.util.UUID;

public record PageLabelView(
        UUID id,
        String name,
        String color,
        int position,
        UUID createdBy,
        OffsetDateTime createdAt) {}
