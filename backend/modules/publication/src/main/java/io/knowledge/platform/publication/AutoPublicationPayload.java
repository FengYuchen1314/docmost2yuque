package io.knowledge.platform.publication;

import java.util.UUID;

record AutoPublicationPayload(UUID pageId, UUID actorId, long draftRevision) {}
