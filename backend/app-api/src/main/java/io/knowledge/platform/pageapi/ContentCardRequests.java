package io.knowledge.platform.pageapi;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

final class ContentCardRequests {

    private ContentCardRequests() {}

    record Page(UUID pageId) {}

    record Usage(UUID pageId, String cardId) {}

    record Instance(UUID instanceId) {}

    record Vote(UUID instanceId, List<String> optionIds) {}

    record Checkin(UUID instanceId, LocalDate localDate) {}
}
