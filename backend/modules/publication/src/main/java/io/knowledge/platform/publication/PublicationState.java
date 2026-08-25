package io.knowledge.platform.publication;

import java.util.UUID;

public record PublicationState(
        UUID pageId,
        long draftRevision,
        UUID publicationId,
        Long publishedDraftRevision,
        boolean published,
        boolean upToDate,
        String effectivePublishMode,
        String automaticJobStatus) {}
