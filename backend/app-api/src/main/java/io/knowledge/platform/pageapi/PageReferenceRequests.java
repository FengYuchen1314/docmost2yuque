package io.knowledge.platform.pageapi;

import java.util.UUID;

final class PageReferenceRequests {

    private PageReferenceRequests() {}

    record Page(UUID pageId) {}

    record Reference(UUID referenceId) {}

    record Graph(UUID pageId, Integer depth, Integer limit) {}
}
