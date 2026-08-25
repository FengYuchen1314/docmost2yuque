package io.knowledge.platform.share;

import java.time.OffsetDateTime;
import java.util.UUID;

public record KnowledgeBaseSharePageView(
        UUID pageId,
        UUID publicationId,
        String title,
        String path,
        String contentType,
        String icon,
        OffsetDateTime publishedAt) {}
