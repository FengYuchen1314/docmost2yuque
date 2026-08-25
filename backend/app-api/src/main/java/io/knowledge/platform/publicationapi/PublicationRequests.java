package io.knowledge.platform.publicationapi;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

final class PublicationRequests {

    private PublicationRequests() {}

    record Publish(UUID pageId, String idempotencyKey) {}

    record Page(UUID pageId) {}

    record History(UUID pageId, Integer limit, Integer offset) {}

    record DatabaseFormSubmit(
            UUID publicationId,
            String idempotencyKey,
            JsonNode values) {}
}
