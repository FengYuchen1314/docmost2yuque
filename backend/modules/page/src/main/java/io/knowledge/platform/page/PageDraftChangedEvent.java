package io.knowledge.platform.page;

import java.util.UUID;

public record PageDraftChangedEvent(UUID pageId, UUID actorId, long draftRevision) {}
